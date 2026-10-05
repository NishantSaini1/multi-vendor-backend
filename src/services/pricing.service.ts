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
//         markupAmount         = vendorOriginalPrice × markupPercent / 100
//         platformSellingPrice = vendorOriginalPrice + markupAmount
//     The seller is settled their original price and the markupAmount is the
//     platform's profit. e.g. original ₹25 at 20% → customer pays ₹30,
//     seller gets ₹25, platform earns ₹5.
//
// Every product, under either model, carries a Platform Selling Price — the
// price the customer pays, stored in the product's price field (and mirrored as
// platformSellingPrice) and never above the printed MRP. Under COMMISSION the
// seller sets it (and keeps a Vendor Original Price alongside, informational);
// under MARKUP it is derived and not editable by hand.
//
// A product's markupPercent also applies to its variants and add-ons (they are
// part of the same item). This module owns that
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

export interface BasePricing {
  // What the customer pays per unit (Platform Selling Price).
  sellingPrice: number;
  // The vendor's own price. Settled to the seller under MARKUP; informational under COMMISSION.
  vendorOriginalPrice: number;
  markupPercent: number;
  markupAmount: number;
}

interface PricedProduct extends MarkupProduct {
  vendorOriginalPrice?: number | null;
}

// A product's own (base) pricing, from what is stored in its price field.
// Current data stores the Platform Selling Price there, with the vendor's price
// in vendorOriginalPrice. Data from before that (a MARKUP product with no
// vendorOriginalPrice) stored the vendor's price there and derived the selling
// price from the markup — handled here so such a product still prices
// correctly until it is migrated.
export function resolveBasePricing(stored: number, config: PricingConfig, product?: PricedProduct): BasePricing {
  if (!isMarkupModel(config)) {
    const vendorOriginalPrice = typeof product?.vendorOriginalPrice === 'number' ? product.vendorOriginalPrice : stored;
    return { sellingPrice: stored, vendorOriginalPrice, markupPercent: 0, markupAmount: 0 };
  }
  const markupPercent = effectiveMarkupPercent(config, product);
  if (typeof product?.vendorOriginalPrice === 'number') {
    return { sellingPrice: stored, vendorOriginalPrice: product.vendorOriginalPrice, markupPercent, markupAmount: round2(stored - product.vendorOriginalPrice) };
  }
  const sellingPrice = applyMarkupPercent(stored, markupPercent);
  return { sellingPrice, vendorOriginalPrice: stored, markupPercent, markupAmount: round2(sellingPrice - stored) };
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

// What a create/update asks for. All optional; which ones make sense depends on
// the seller's pricing model (see pricingRequestFromInput / applyProductPricing).
export interface PricingRequest {
  // COMMISSION: the Platform Selling Price the seller sets.
  sellingPrice?: number;
  vendorOriginalPrice?: number;
  // MARKUP: only accepted if it equals the derived price.
  platformSellingPrice?: number;
  // MARKUP: admin-only.
  markupPercent?: number;
}

// Pulls the pricing fields out of a create/update body (removing them from it),
// mapping the older single price field the apps already send: under COMMISSION
// that is the selling price (unchanged), under MARKUP it is the vendor's
// original price.
export function pricingRequestFromInput(config: PricingConfig, data: Record<string, unknown>, legacyKey: 'price' | 'sellingPrice'): PricingRequest {
  const take = (key: string): number | undefined => {
    const value = data[key];
    delete data[key];
    return typeof value === 'number' ? value : undefined;
  };
  const request: PricingRequest = {
    vendorOriginalPrice: take('vendorOriginalPrice'),
    platformSellingPrice: take('platformSellingPrice'),
    markupPercent: take('markupPercent'),
  };
  const legacy = take(legacyKey);
  if (isMarkupModel(config)) {
    request.vendorOriginalPrice ??= legacy;
  } else {
    request.sellingPrice = request.platformSellingPrice ?? legacy;
  }
  return request;
}

export function hasPricingRequest(request: PricingRequest): boolean {
  return Object.values(request).some((v) => v !== undefined);
}

// Applies a create/update to a product's stored pricing — the one place the
// price fields are written, so they cannot drift apart:
//   COMMISSION  the seller sets the Platform Selling Price (required); the
//               Vendor Original Price is kept alongside (defaults to it).
//   MARKUP      the seller sets the Vendor Original Price; an admin sets the
//               markup %; markupAmount and the Platform Selling Price follow.
//               A selling price that conflicts with that is refused.
// and the Platform Selling Price may never exceed the printed MRP.
// `field` is the product's price field: 'price' (Food) or 'sellingPrice' (Instamart).
export function applyProductPricing(
  product: object,
  field: 'price' | 'sellingPrice',
  config: PricingConfig,
  user: JwtPayload,
  request: PricingRequest,
  mrp?: number | null,
): void {
  const doc = product as Record<string, number | undefined>;
  const markup = isMarkupModel(config);

  if (request.markupPercent !== undefined) {
    if (user.userType !== 'ADMIN') throw ApiError.forbidden('Only the platform can set a product markup', 'MARKUP_ADMIN_ONLY');
    if (!markup) throw ApiError.badRequest('A product markup can only be set for a seller on the MARKUP pricing model', 'NOT_A_MARKUP_SELLER');
  }

  const stored = doc[field];
  let sellingPrice: number;
  let vendorOriginalPrice: number;
  let markupPercent = doc.markupPercent ?? 0;
  let markupAmount = 0;

  if (markup) {
    const current = stored !== undefined ? resolveBasePricing(stored, config, doc) : undefined;
    const original = request.vendorOriginalPrice ?? current?.vendorOriginalPrice;
    if (original === undefined) throw ApiError.badRequest('Vendor original price is required', 'VENDOR_ORIGINAL_PRICE_REQUIRED');
    markupPercent = request.markupPercent ?? markupPercent;
    vendorOriginalPrice = original;
    sellingPrice = applyMarkupPercent(original, markupPercent);
    markupAmount = round2(sellingPrice - original);
    if (request.platformSellingPrice !== undefined && Math.abs(request.platformSellingPrice - sellingPrice) > 0.005) {
      throw ApiError.unprocessable(
        'The platform selling price is calculated from the vendor original price and the markup — it cannot be set by hand for a MARKUP product.',
        'PLATFORM_PRICE_DERIVED',
      );
    }
  } else {
    const selling = request.sellingPrice ?? stored;
    if (selling === undefined) throw ApiError.badRequest('Platform selling price is required', 'PLATFORM_PRICE_REQUIRED');
    sellingPrice = selling;
    vendorOriginalPrice = request.vendorOriginalPrice ?? doc.vendorOriginalPrice ?? selling;
  }

  if (typeof mrp === 'number' && mrp > 0 && sellingPrice > mrp + 0.005) {
    throw ApiError.unprocessable('Platform selling price cannot be greater than MRP.', 'PLATFORM_PRICE_ABOVE_MRP', { sellingPrice, mrp });
  }

  doc[field] = sellingPrice;
  doc.platformSellingPrice = sellingPrice;
  doc.vendorOriginalPrice = vendorOriginalPrice;
  doc.markupPercent = markupPercent;
  doc.markupAmount = markupAmount;
}

// Brings every product of a seller back in line with its current pricing model
// — called whenever the model changes, and by the migration script.
//   → MARKUP      the selling price is re-derived from vendorOriginalPrice and
//                 the product's markup %. A product with no markup yet but a
//                 selling price above its vendor price gets the markup that
//                 reproduces that price, so customers' prices don't jump.
//   → COMMISSION  the selling price the customer pays is kept as it is; the
//                 effective markup is 0 (markupPercent is remembered).
export async function syncSellerProductPrices(owner: 'VENDOR' | 'STORE', sellerId: string): Promise<void> {
  const config = await loadPricingConfig(owner, sellerId);
  const markup = isMarkupModel(config);
  const isFood = owner === 'VENDOR';
  const field = isFood ? 'price' : 'sellingPrice';
  const products = isFood
    ? await VendorFoodItem.find({ vendorId: sellerId }).select('price vendorOriginalPrice markupPercent')
    : await InstamartProduct.find({ storeId: sellerId }).select('sellingPrice vendorOriginalPrice markupPercent');
  if (products.length === 0) return;

  const ops = products.map((product) => {
    const doc = product as unknown as Record<string, number | undefined>;
    const stored = doc[field] as number;
    const legacy = doc.vendorOriginalPrice === undefined;
    let sellingPrice: number;
    let vendorOriginalPrice: number;
    let markupPercent = doc.markupPercent ?? 0;

    if (markup) {
      vendorOriginalPrice = doc.vendorOriginalPrice ?? stored;
      if (!(markupPercent > 0) && !legacy && vendorOriginalPrice > 0 && stored > vendorOriginalPrice) {
        markupPercent = round2((stored / vendorOriginalPrice - 1) * 100);
      }
      sellingPrice = applyMarkupPercent(vendorOriginalPrice, markupPercent);
    } else {
      // A product from before vendorOriginalPrice existed stored the vendor's price
      // (and the marked-up price was derived) — keep what customers were paying.
      sellingPrice = legacy && markupPercent > 0 ? applyMarkupPercent(stored, markupPercent) : stored;
      vendorOriginalPrice = doc.vendorOriginalPrice ?? stored;
    }
    const markupAmount = markup ? round2(sellingPrice - vendorOriginalPrice) : 0;
    return {
      updateOne: {
        filter: { _id: product._id },
        update: { $set: { [field]: sellingPrice, platformSellingPrice: sellingPrice, vendorOriginalPrice, markupPercent, markupAmount } },
      },
    };
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

const MARKUP_FIELDS = ['markupPercent', 'platformSellingPrice', 'markupAmount', 'vendorOriginalPrice', 'costPrice', 'minVariantPrice'] as const;

function stripMarkupFields<T extends Record<string, unknown>>(plain: T): T {
  const out: Record<string, unknown> = { ...plain };
  for (const field of MARKUP_FIELDS) delete out[field];
  return out as T;
}

export function markupFoodItem<T extends Record<string, unknown>>(plain: T, config: PricingConfig): T {
  const price = resolveBasePricing(plain.price as number, config, plain as PricedProduct).sellingPrice;
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
  const base = resolveBasePricing(plain.sellingPrice as number, config, plain as PricedProduct).sellingPrice;
  const out: Record<string, unknown> = { ...plain, sellingPrice: base };

  // Fields added by instamartProduct.service's attachVariantInfo. The base pack
  // is already at its selling price; a variant carries the product's markup %.
  if (typeof plain.variantPriceFrom === 'number') {
    out.variantPriceFrom = plain.variantIdFrom ? applyMarkupPercent(plain.variantPriceFrom, percent) : base;
  }
  if (typeof plain.minPackPrice === 'number') {
    out.minPackPrice =
      typeof plain.minVariantPrice === 'number' ? Math.min(base, applyMarkupPercent(plain.minVariantPrice, percent)) : base;
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
// its own vendor price, commission and what it is owed, but never the
// platform's own revenue, costs and profit — including the markup profit the
// platform made on an order. (A seller still sees each PRODUCT's markup % and
// amount on its own product screens; those are not order data.) Admins see
// everything.
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
  'commissionPercent',
  'vendorPrice',
  'vendorOriginalPrice',
  'vendorPayable',
  'refundRatio',
] as const;

const PLATFORM_ONLY_FIELDS = [
  'platformProfit',
  'platformRevenue',
  // The markup profit on an order/line is the platform's.
  'markupAmount',
  'unitMarkupAmount',
  'totalAdminProfit',
  'totalAdminMarkupProfit',
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
