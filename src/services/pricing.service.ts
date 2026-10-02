import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { Order } from '../models/Order';
import { ApiError } from '../utils/ApiError';
import { JwtPayload } from '../utils/jwt';
import { assertOwnerOrLocationAccess } from '../middleware/rbac.middleware';
import { DISCOUNT_TYPES, PRICING_MODELS } from '../constants/enums';
import { FOOD_ORDER_STATUS } from '../constants/orderStatus';

// Vendor/store pricing models (see PRICING_MODELS in enums.ts).
//
//   COMMISSION — customer pays the vendor's own price; the platform keeps a
//     commission (resolved per order by commission.service.resolveCommission)
//     and the rest is settled to the vendor.
//   MARKUP — no commission. The platform shows customers the vendor's price
//     plus a markup (a % or a flat amount per unit); the vendor is settled
//     their original price in full and the markup is the platform's profit.
//     e.g. vendor ₹100 + 20% -> customer pays ₹120, vendor gets ₹100,
//     platform profit ₹20.
//
// This module is the single source of truth for that math — the catalog
// listings (what a customer sees), the cart/checkout (what a customer pays)
// and the order snapshot (what gets settled) all go through it, so the three
// can never disagree.

export interface PricingConfig {
  pricingModel: string;
  markupType: string;
  markupValue: number;
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  pricingModel: PRICING_MODELS.COMMISSION,
  markupType: DISCOUNT_TYPES.PERCENTAGE,
  markupValue: 0,
};

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toPricingConfig(source: { pricingModel?: string; markupType?: string; markupValue?: number } | null | undefined): PricingConfig {
  if (!source) return DEFAULT_PRICING_CONFIG;
  return {
    pricingModel: source.pricingModel ?? PRICING_MODELS.COMMISSION,
    markupType: source.markupType ?? DISCOUNT_TYPES.PERCENTAGE,
    markupValue: source.markupValue ?? 0,
  };
}

export function isMarkupModel(config: PricingConfig): boolean {
  return config.pricingModel === PRICING_MODELS.MARKUP && config.markupValue > 0;
}

// The price a customer sees/pays for ONE unit of an item the vendor lists at
// `vendorPrice`. A flat markup is per unit.
export function customerUnitPrice(vendorPrice: number, config: PricingConfig): number {
  if (!isMarkupModel(config)) return vendorPrice;
  if (config.markupType === DISCOUNT_TYPES.PERCENTAGE) return round2(vendorPrice * (1 + config.markupValue / 100));
  return round2(vendorPrice + config.markupValue);
}

// Modifier/add-on prices only carry a percentage markup — a flat markup is
// already charged once per unit on the item itself, so adding it to every
// add-on as well would double-charge.
export function customerModifierPrice(vendorPrice: number, config: PricingConfig): number {
  if (!isMarkupModel(config) || config.markupType !== DISCOUNT_TYPES.PERCENTAGE) return vendorPrice;
  return round2(vendorPrice * (1 + config.markupValue / 100));
}

export async function loadPricingConfigs(owner: 'VENDOR' | 'STORE', ids: string[]): Promise<Map<string, PricingConfig>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const query = { _id: { $in: unique } };
  const fields = 'pricingModel markupType markupValue';
  const docs = owner === 'VENDOR' ? await Vendor.find(query).select(fields) : await Store.find(query).select(fields);
  return new Map(docs.map((d) => [d.id as string, toPricingConfig(d)]));
}

export async function loadPricingConfig(owner: 'VENDOR' | 'STORE', id: string): Promise<PricingConfig> {
  return (await loadPricingConfigs(owner, [id])).get(id) ?? DEFAULT_PRICING_CONFIG;
}

// --- Customer-facing listing transforms ---------------------------------
// Each takes a plain object (already `.toObject()`/lean) and rewrites its
// price fields to what a CUSTOMER should see. Callers apply them only for
// CUSTOMER requests — vendor/store/admin views keep the raw prices.

export function markupFoodItem<T extends Record<string, unknown>>(plain: T, config: PricingConfig): T {
  if (!isMarkupModel(config)) return plain;
  const price = customerUnitPrice(plain.price as number, config);
  const mrp = plain.mrp as number | undefined;
  return { ...plain, price, ...(mrp !== undefined && mrp !== null ? { mrp: Math.max(mrp, price) } : {}) };
}

export function markupFoodVariant<T extends Record<string, unknown>>(plain: T, config: PricingConfig): T {
  return markupFoodItem(plain, config);
}

export function markupModifierOption<T extends Record<string, unknown>>(plain: T, config: PricingConfig): T {
  if (!isMarkupModel(config)) return plain;
  return { ...plain, price: customerModifierPrice(plain.price as number, config) };
}

// Instamart: the MRP lives on the shared global product and is left alone.
export function markupMartVariant<T extends Record<string, unknown>>(plain: T, config: PricingConfig): T {
  if (!isMarkupModel(config)) return plain;
  return { ...plain, sellingPrice: customerUnitPrice(plain.sellingPrice as number, config) };
}

export function markupMartListing<T extends Record<string, unknown>>(plain: T, config: PricingConfig): T {
  if (!isMarkupModel(config)) return plain;
  const out: Record<string, unknown> = { ...plain, sellingPrice: customerUnitPrice(plain.sellingPrice as number, config) };
  // Fields added by instamartProduct.service's attachVariantInfo.
  for (const key of ['variantPriceFrom', 'minPackPrice']) {
    if (typeof out[key] === 'number') out[key] = customerUnitPrice(out[key] as number, config);
  }
  return out as T;
}

// Batch versions for list endpoints that span several sellers (search,
// favorites, a marketplace-wide product list): one config query for all of
// them, then each row is priced by its own seller's model.
export async function markupMartListings<T extends Record<string, unknown>>(items: T[], storeIdOf: (item: T) => string): Promise<T[]> {
  if (items.length === 0) return items;
  const configs = await loadPricingConfigs('STORE', items.map(storeIdOf));
  return items.map((item) => markupMartListing(item, configs.get(storeIdOf(item)) ?? DEFAULT_PRICING_CONFIG));
}

export async function markupFoodItems<T extends Record<string, unknown>>(items: T[], vendorIdOf: (item: T) => string): Promise<T[]> {
  if (items.length === 0) return items;
  const configs = await loadPricingConfigs('VENDOR', items.map(vendorIdOf));
  return items.map((item) => markupFoodItem(item, configs.get(vendorIdOf(item)) ?? DEFAULT_PRICING_CONFIG));
}

// --- Per-order snapshot ---------------------------------------------------

export interface OrderPricingSnapshot {
  pricingModel: string;
  markupType?: string;
  markupValue?: number;
  customerPrice: number;
  vendorBaseAmount: number;
  markupAmount: number;
  vendorSettlementAmount: number;
  platformProfit: number;
}

// `customerAmount` is what the customer pays for the items net of item-level
// discounts (subtotal - discount); `vendorAmount` is the same lines priced at
// the vendor's own prices. Under COMMISSION both are equal and the platform's
// cut is `commissionAmount`; under MARKUP the platform's cut is the gap
// between them and there is no commission.
export function buildOrderPricingSnapshot(params: {
  config: PricingConfig;
  customerAmount: number;
  vendorAmount: number;
  commissionAmount?: number;
}): OrderPricingSnapshot {
  const customerPrice = round2(params.customerAmount);

  if (isMarkupModel(params.config)) {
    const vendorBaseAmount = round2(Math.min(params.vendorAmount, params.customerAmount));
    const markupAmount = round2(customerPrice - vendorBaseAmount);
    return {
      pricingModel: PRICING_MODELS.MARKUP,
      markupType: params.config.markupType,
      markupValue: params.config.markupValue,
      customerPrice,
      vendorBaseAmount,
      markupAmount,
      vendorSettlementAmount: vendorBaseAmount,
      platformProfit: markupAmount,
    };
  }

  const commissionAmount = round2(params.commissionAmount ?? 0);
  return {
    pricingModel: PRICING_MODELS.COMMISSION,
    customerPrice,
    vendorBaseAmount: customerPrice,
    markupAmount: 0,
    vendorSettlementAmount: round2(customerPrice - commissionAmount),
    platformProfit: commissionAmount,
  };
}

// Worked example for the admin/vendor "what would this look like" preview —
// a single line at `vendorPrice` x `quantity`, no discounts.
export function previewPricing(params: {
  vendorPrice: number;
  quantity: number;
  config: PricingConfig;
  commissionType?: string;
  commissionValue?: number;
}) {
  const { vendorPrice, quantity, config } = params;
  const customerUnit = customerUnitPrice(vendorPrice, config);
  const vendorAmount = round2(vendorPrice * quantity);
  const customerAmount = round2(customerUnit * quantity);
  let commissionAmount = 0;
  if (!isMarkupModel(config) && params.commissionValue) {
    commissionAmount =
      params.commissionType === DISCOUNT_TYPES.FIXED ? params.commissionValue : customerAmount * (params.commissionValue / 100);
  }
  return {
    vendorPrice,
    customerUnitPrice: customerUnit,
    quantity,
    ...buildOrderPricingSnapshot({ config, customerAmount, vendorAmount, commissionAmount }),
  };
}

// --- Redaction ----------------------------------------------------------------

// What the vendor is paid and what the platform earns is between the platform
// and the seller — a customer or delivery partner reading an order (or its
// items) must only see what the customer paid, never the vendor's original
// price or the markup/profit. Admins, vendors and stores see everything.
const ORDER_PRICING_PRIVATE_FIELDS = [
  'pricingModel',
  'markupType',
  'markupValue',
  'vendorBaseAmount',
  'markupAmount',
  'vendorSettlementAmount',
  'platformProfit',
] as const;

const REDACTED_VIEWERS = new Set(['CUSTOMER', 'DELIVERY_PARTNER']);

export function redactPricingForViewer<T>(data: T, userType: string): T {
  if (!REDACTED_VIEWERS.has(userType) || data === null || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map((entry) => redactPricingForViewer(entry, userType)) as unknown as T;

  const source = data as unknown as { toJSON?: () => Record<string, unknown> };
  const plain = { ...(typeof source.toJSON === 'function' ? source.toJSON() : (data as Record<string, unknown>)) };
  for (const field of ORDER_PRICING_PRIVATE_FIELDS) delete plain[field];
  delete plain.vendorPrice;
  return plain as unknown as T;
}

// --- Config management ------------------------------------------------------

export interface UpdatePricingInput {
  pricingModel: string;
  markupType?: string;
  markupValue?: number;
}

function applyPricingInput(target: { pricingModel: string; markupType: string; markupValue: number }, input: UpdatePricingInput) {
  if (input.pricingModel === PRICING_MODELS.MARKUP) {
    const markupType = input.markupType ?? target.markupType;
    const markupValue = input.markupValue ?? target.markupValue;
    if (!(markupValue > 0)) {
      throw ApiError.badRequest('A markupValue greater than 0 is required for the MARKUP pricing model', 'MARKUP_VALUE_REQUIRED');
    }
    if (markupType === DISCOUNT_TYPES.PERCENTAGE && markupValue > 500) {
      throw ApiError.badRequest('A percentage markup cannot exceed 500%', 'MARKUP_TOO_HIGH');
    }
    target.pricingModel = PRICING_MODELS.MARKUP;
    target.markupType = markupType;
    target.markupValue = markupValue;
    return;
  }
  // Back to COMMISSION — keep the last markup values around so switching back
  // later pre-fills them, but they're ignored while the model is COMMISSION.
  target.pricingModel = PRICING_MODELS.COMMISSION;
}

export async function getVendorPricing(vendorId: string, user: JwtPayload) {
  const vendor = await Vendor.findById(vendorId).select('restaurantName locationId pricingModel markupType markupValue');
  if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
  assertOwnerOrLocationAccess(user, vendor.id, vendor.locationId.toString());
  return { id: vendor.id, name: vendor.restaurantName, ...toPricingConfig(vendor) };
}

export async function updateVendorPricing(vendorId: string, input: UpdatePricingInput, user: JwtPayload) {
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
  assertOwnerOrLocationAccess(user, vendor.id, vendor.locationId.toString());
  applyPricingInput(vendor, input);
  await vendor.save();
  return { id: vendor.id, name: vendor.restaurantName, ...toPricingConfig(vendor) };
}

export async function getStorePricing(storeId: string, user: JwtPayload) {
  const store = await Store.findById(storeId).select('name locationId pricingModel markupType markupValue');
  if (!store) throw ApiError.notFound('Store not found', 'STORE_NOT_FOUND');
  assertOwnerOrLocationAccess(user, store.id, store.locationId.toString());
  return { id: store.id, name: store.name, ...toPricingConfig(store) };
}

export async function updateStorePricing(storeId: string, input: UpdatePricingInput, user: JwtPayload) {
  const store = await Store.findById(storeId);
  if (!store) throw ApiError.notFound('Store not found', 'STORE_NOT_FOUND');
  assertOwnerOrLocationAccess(user, store.id, store.locationId.toString());
  applyPricingInput(store, input);
  await store.save();
  return { id: store.id, name: store.name, ...toPricingConfig(store) };
}

// --- Earnings report (admin) -----------------------------------------------

// Platform earnings by pricing model over DELIVERED orders, from the
// per-order snapshots — so it always reflects what was actually charged at
// the time, not today's config.
export async function getPricingEarnings(
  filter: Record<string, unknown>,
  range: { from?: Date; to?: Date },
) {
  const match: Record<string, unknown> = { ...filter, status: FOOD_ORDER_STATUS.DELIVERED, pricingModel: { $exists: true } };
  if (range.from || range.to) {
    match.createdAt = { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lt: range.to } : {}) };
  }

  const rows = await Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$pricingModel',
        orders: { $sum: 1 },
        customerPrice: { $sum: '$customerPrice' },
        vendorSettlementAmount: { $sum: '$vendorSettlementAmount' },
        commissionAmount: { $sum: { $ifNull: ['$commissionAmount', 0] } },
        markupAmount: { $sum: { $ifNull: ['$markupAmount', 0] } },
        platformProfit: { $sum: '$platformProfit' },
      },
    },
  ]);

  const empty = { orders: 0, customerPrice: 0, vendorSettlementAmount: 0, commissionAmount: 0, markupAmount: 0, platformProfit: 0 };
  const byModel = Object.fromEntries(Object.values(PRICING_MODELS).map((m) => [m, { ...empty }])) as Record<string, typeof empty>;
  for (const row of rows) {
    const { _id, ...rest } = row;
    byModel[_id] = Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, k === 'orders' ? (v as number) : round2(v as number)])) as typeof empty;
  }
  const total = Object.values(byModel).reduce(
    (acc, m) => ({
      orders: acc.orders + m.orders,
      customerPrice: round2(acc.customerPrice + m.customerPrice),
      vendorSettlementAmount: round2(acc.vendorSettlementAmount + m.vendorSettlementAmount),
      commissionAmount: round2(acc.commissionAmount + m.commissionAmount),
      markupAmount: round2(acc.markupAmount + m.markupAmount),
      platformProfit: round2(acc.platformProfit + m.platformProfit),
    }),
    { ...empty },
  );
  return { byModel, total };
}
