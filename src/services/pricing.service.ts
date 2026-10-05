import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { VendorFoodItem } from '../models/VendorFoodItem';
import { InstamartProduct } from '../models/InstamartProduct';
import { ApiError } from '../utils/ApiError';
import { JwtPayload } from '../utils/jwt';
import { assertOwnerOrLocationAccess } from '../middleware/rbac.middleware';
import { PRICING_MODELS } from '../constants/enums';

// Vendor/store pricing models (see PRICING_MODELS in enums.ts). One model is
// chosen per vendor/store and applies to everything it sells, Food or
// Instamart alike.
//
//   COMMISSION — the customer pays the seller's own price; the platform keeps
//     the vendor/store profile's `commissionPercent` of each item and the rest
//     is settled to the seller. Configured on the profile, never per product.
//
//   MARKUP — no commission. The seller only has `pricingModel: MARKUP`; the
//     markup itself is set PER PRODUCT (`markupPercent`), so two products of the
//     same seller can carry different markups:
//         markupAmount         = original price × markupPercent / 100
//         platformSellingPrice = original price + markupAmount
//     The seller is settled their original price and the markupAmount is the
//     platform's profit. e.g. original ₹100 at 20% → customer pays ₹120,
//     seller gets ₹100, platform earns ₹20.
//
// A product's markupPercent applies to its own price and equally to its
// variants and add-ons (they are part of the same item). This module owns that
// price math; the per-order money math lives in orderFinancials.service.ts.
// Catalog listings (what a customer sees), the cart/checkout (what a customer
// pays) and the order snapshot (what gets settled) all go through these two, so
// they can never disagree.

export interface PricingConfig {
  pricingModel: string;
  commissionPercent?: number;
}

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  pricingModel: PRICING_MODELS.COMMISSION,
};

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toPricingConfig(
  source: { pricingModel?: string; commissionPercent?: number | null } | null | undefined,
): PricingConfig {
  if (!source) return DEFAULT_PRICING_CONFIG;
  return {
    pricingModel: source.pricingModel ?? PRICING_MODELS.COMMISSION,
    commissionPercent: typeof source.commissionPercent === 'number' ? source.commissionPercent : undefined,
  };
}

export function isMarkupModel(config: PricingConfig): boolean {
  return config.pricingModel === PRICING_MODELS.MARKUP;
}

interface MarkupProduct {
  markupPercent?: number | null;
}

// The markup % in effect for a product: its own under MARKUP, none otherwise.
export function effectiveMarkupPercent(config: PricingConfig, product?: MarkupProduct): number {
  if (!isMarkupModel(config)) return 0;
  const percent = product?.markupPercent;
  return typeof percent === 'number' && percent > 0 ? percent : 0;
}

export function applyMarkupPercent(price: number, percent: number): number {
  return percent > 0 ? round2(price * (1 + percent / 100)) : price;
}

// What a customer pays for ONE unit of an item (or one of its variants /
// add-ons) the seller lists at `vendorPrice`: the original price plus the
// product's own markup under MARKUP, the original price otherwise.
export function customerUnitPrice(vendorPrice: number, config: PricingConfig, product?: MarkupProduct): number {
  return applyMarkupPercent(vendorPrice, effectiveMarkupPercent(config, product));
}

// An add-on is part of the same item, so it carries the item's markup too.
export const customerModifierPrice = customerUnitPrice;

// The platform selling price of a product's own (base) price.
export const platformPriceFor = customerUnitPrice;

// The denormalised fields stored on a product for display/reporting.
export function derivePlatformFields(vendorPrice: number, config: PricingConfig, product?: MarkupProduct) {
  const platformSellingPrice = platformPriceFor(vendorPrice, config, product);
  return { platformSellingPrice, markupAmount: round2(platformSellingPrice - vendorPrice) };
}

export async function loadPricingConfigs(owner: 'VENDOR' | 'STORE', ids: string[]): Promise<Map<string, PricingConfig>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const query = { _id: { $in: unique } };
  const fields = 'pricingModel commissionPercent';
  const docs = owner === 'VENDOR' ? await Vendor.find(query).select(fields) : await Store.find(query).select(fields);
  return new Map(docs.map((d) => [d.id as string, toPricingConfig(d)]));
}

export async function loadPricingConfig(owner: 'VENDOR' | 'STORE', id: string): Promise<PricingConfig> {
  return (await loadPricingConfigs(owner, [id])).get(id) ?? DEFAULT_PRICING_CONFIG;
}

// Applies an item's create/update to its stored markup fields. Only an admin
// may set a product's markup, and only on a MARKUP seller's product
// (`requested`: the new markup %). The platform price and markup amount are
// always re-derived from the current original price.
export function applyProductMarkup(
  product: { markupPercent: number; platformSellingPrice?: number | null; markupAmount: number },
  vendorPrice: number,
  config: PricingConfig,
  user: JwtPayload,
  requested?: number,
): void {
  if (requested !== undefined) {
    if (user.userType !== 'ADMIN') {
      throw ApiError.forbidden('Only the platform can set a product markup', 'MARKUP_ADMIN_ONLY');
    }
    if (!isMarkupModel(config)) {
      throw ApiError.badRequest('A product markup can only be set for a seller on the MARKUP pricing model', 'NOT_A_MARKUP_SELLER');
    }
    product.markupPercent = requested;
  }
  const derived = derivePlatformFields(vendorPrice, config, product);
  product.platformSellingPrice = derived.platformSellingPrice;
  product.markupAmount = derived.markupAmount;
}

// Brings every product of a seller back in line with its current pricing model
// — called whenever the model changes. A product keeps its markupPercent while
// the seller is on COMMISSION (so switching back restores it) but its
// effective markup, platform price and markup amount are 0 / its own price.
export async function syncSellerProductPrices(owner: 'VENDOR' | 'STORE', sellerId: string): Promise<void> {
  const config = await loadPricingConfig(owner, sellerId);
  const isFood = owner === 'VENDOR';
  const products = isFood
    ? await VendorFoodItem.find({ vendorId: sellerId }).select('price markupPercent')
    : await InstamartProduct.find({ storeId: sellerId }).select('sellingPrice markupPercent');
  if (products.length === 0) return;

  const ops = products.map((product) => {
    const vendorPrice = isFood ? (product as unknown as { price: number }).price : (product as unknown as { sellingPrice: number }).sellingPrice;
    return { updateOne: { filter: { _id: product._id }, update: { $set: derivePlatformFields(vendorPrice, config, product) } } };
  });
  if (isFood) await VendorFoodItem.bulkWrite(ops);
  else await InstamartProduct.bulkWrite(ops);
}

// --- Customer-facing listing transforms ---------------------------------
// Each takes a plain object (already `.toObject()`/lean) and rewrites its
// price fields to what a CUSTOMER should see, and drops the markup internals.
// Callers apply them only for CUSTOMER requests — vendor/store/admin views keep
// the raw prices. Variants and add-ons take their parent item/product so they
// carry its markup %.

const MARKUP_FIELDS = ['markupPercent', 'platformSellingPrice', 'markupAmount'] as const;

function stripMarkupFields<T extends Record<string, unknown>>(plain: T): T {
  const out: Record<string, unknown> = { ...plain };
  for (const field of MARKUP_FIELDS) delete out[field];
  return out as T;
}

export function markupFoodItem<T extends Record<string, unknown>>(plain: T, config: PricingConfig): T {
  const price = customerUnitPrice(plain.price as number, config, plain as MarkupProduct);
  const mrp = plain.mrp as number | undefined;
  return stripMarkupFields({ ...plain, price, ...(mrp !== undefined && mrp !== null ? { mrp: Math.max(mrp, price) } : {}) });
}

export function markupFoodVariant<T extends Record<string, unknown>>(plain: T, config: PricingConfig, item: MarkupProduct): T {
  if (!isMarkupModel(config)) return plain;
  const price = customerUnitPrice(plain.price as number, config, item);
  const mrp = plain.mrp as number | undefined;
  return { ...plain, price, ...(mrp !== undefined && mrp !== null ? { mrp: Math.max(mrp, price) } : {}) };
}

export function markupModifierOption<T extends Record<string, unknown>>(plain: T, config: PricingConfig, item: MarkupProduct): T {
  if (!isMarkupModel(config)) return plain;
  return { ...plain, price: customerModifierPrice(plain.price as number, config, item) };
}

// Instamart: the MRP lives on the shared global product and is left alone.
export function markupMartVariant<T extends Record<string, unknown>>(plain: T, config: PricingConfig, product: MarkupProduct): T {
  if (!isMarkupModel(config)) return plain;
  return { ...plain, sellingPrice: customerUnitPrice(plain.sellingPrice as number, config, product) };
}

export function markupMartListing<T extends Record<string, unknown>>(plain: T, config: PricingConfig): T {
  if (!isMarkupModel(config)) return stripMarkupFields(plain);
  const percent = effectiveMarkupPercent(config, plain as MarkupProduct);
  const out: Record<string, unknown> = { ...plain, sellingPrice: applyMarkupPercent(plain.sellingPrice as number, percent) };

  // Fields added by instamartProduct.service's attachVariantInfo — prices of the
  // base pack or of a variant, all under the same product markup.
  for (const field of ['variantPriceFrom', 'minPackPrice']) {
    if (typeof plain[field] === 'number') out[field] = applyMarkupPercent(plain[field] as number, percent);
  }
  return stripMarkupFields(out) as T;
}

// Batch versions for list endpoints that span several sellers (search,
// favorites, a marketplace-wide product list): one config query for all of
// them, then each row is priced by its own seller's model and its own markup.
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

// --- Redaction ----------------------------------------------------------------

// What the seller is paid and what the platform earns is between the platform
// and the seller. A customer or delivery partner reading an order (or its
// items) sees only what the customer paid; a vendor/store additionally sees
// its own commission/markup/settlement but never the platform's own revenue,
// costs and profit. Admins see everything.
const SELLER_ONLY_FIELDS = [
  'pricingModel',
  'markupType',
  'markupValue',
  'markupPercent',
  'unitMarkupAmount',
  'vendorBaseAmount',
  'markupAmount',
  'vendorSettlementAmount',
  'totalVendorAmount',
  'commissionType',
  'commissionRate',
  'commissionBaseAmount',
  'commissionAmount',
  'vendorPrice',
] as const;

const PLATFORM_ONLY_FIELDS = [
  'platformProfit',
  'platformRevenue',
  'totalAdminProfit',
  'deliveryRevenue',
  'deliveryPartnerPayout',
  'paymentGatewayFee',
  'couponExpense',
  'platformExpenses',
  'platformNetProfit',
] as const;

export function redactPricingForViewer<T>(data: T, userType: string): T {
  const hide =
    userType === 'CUSTOMER' || userType === 'DELIVERY_PARTNER'
      ? [...SELLER_ONLY_FIELDS, ...PLATFORM_ONLY_FIELDS]
      : userType === 'VENDOR' || userType === 'STORE'
        ? [...PLATFORM_ONLY_FIELDS]
        : [];
  if (hide.length === 0 || data === null || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map((entry) => redactPricingForViewer(entry, userType)) as unknown as T;

  const source = data as unknown as { toJSON?: () => Record<string, unknown> };
  const plain = { ...(typeof source.toJSON === 'function' ? source.toJSON() : (data as Record<string, unknown>)) };
  for (const field of hide) delete plain[field];
  return plain as unknown as T;
}

// --- Config management ------------------------------------------------------

export interface UpdatePricingInput {
  pricingModel?: string;
  // null clears it (back to the older Commission rules).
  commissionPercent?: number | null;
}

// A seller may choose its own pricing MODEL, but the commission % the platform
// charges is the platform's to set, so only an admin can change it. (Markup is
// per product — see applyProductMarkup.)
function applyPricingInput(target: { pricingModel: string; commissionPercent?: number }, input: UpdatePricingInput, user: JwtPayload) {
  if (input.commissionPercent !== undefined && user.userType !== 'ADMIN') {
    throw ApiError.forbidden('Only the platform can set the commission rate', 'PRICING_RATES_ADMIN_ONLY');
  }
  if (input.pricingModel !== undefined) target.pricingModel = input.pricingModel;
  if (input.commissionPercent !== undefined) target.commissionPercent = input.commissionPercent ?? undefined;
}

function describe(doc: { id?: string; pricingModel: string; commissionPercent?: number }, name: string) {
  return { id: doc.id as string, name, ...toPricingConfig(doc) };
}

export async function getVendorPricing(vendorId: string, user: JwtPayload) {
  const vendor = await Vendor.findById(vendorId).select('restaurantName locationId pricingModel commissionPercent');
  if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
  assertOwnerOrLocationAccess(user, vendor.id, vendor.locationId.toString());
  return describe(vendor, vendor.restaurantName);
}

export async function updateVendorPricing(vendorId: string, input: UpdatePricingInput, user: JwtPayload) {
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
  assertOwnerOrLocationAccess(user, vendor.id, vendor.locationId.toString());
  applyPricingInput(vendor, input, user);
  await vendor.save({ validateModifiedOnly: true });
  await syncSellerProductPrices('VENDOR', vendor.id);
  return describe(vendor, vendor.restaurantName);
}

export async function getStorePricing(storeId: string, user: JwtPayload) {
  const store = await Store.findById(storeId).select('name locationId pricingModel commissionPercent');
  if (!store) throw ApiError.notFound('Store not found', 'STORE_NOT_FOUND');
  assertOwnerOrLocationAccess(user, store.id, store.locationId.toString());
  return describe(store, store.name);
}

export async function updateStorePricing(storeId: string, input: UpdatePricingInput, user: JwtPayload) {
  const store = await Store.findById(storeId);
  if (!store) throw ApiError.notFound('Store not found', 'STORE_NOT_FOUND');
  assertOwnerOrLocationAccess(user, store.id, store.locationId.toString());
  applyPricingInput(store, input, user);
  await store.save({ validateModifiedOnly: true });
  await syncSellerProductPrices('STORE', store.id);
  return describe(store, store.name);
}
