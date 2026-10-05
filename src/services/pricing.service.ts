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
// Instamart alike. Both start from the same product pricing: an MRP (the
// printed price), a Selling Price (what the customer pays) and an optional
// Discount. The seller sets the Selling Price; it never exceeds the MRP.
//
//   COMMISSION — the platform keeps the vendor/store profile's
//     `commissionPercent` of each sale and settles the rest to the seller.
//     Unchanged; configured on the profile, never per product.
//
//   MARKUP — the platform's earning is a per-PRODUCT markup %, set by an admin
//     and invisible to customers and sellers. The Selling Price is the
//     customer's price, and the markup is the platform's share of it:
//         vendor payable per unit = sellingPrice / (1 + markupPercent / 100)
//         markupAmount (admin profit per unit) = sellingPrice − vendor payable
//     e.g. selling ₹30 at 20% → the vendor is settled ₹25 and the platform
//     keeps ₹5. Two products of the same seller can carry different markups.
//
// A product's markup % also covers its variants and add-ons (they are part of
// the same item). Customers always see exactly the stored selling prices —
// nothing about the markup is added to or hidden in what they are shown; it is
// only ever used to split a sale between the seller and the platform (see
// orderFinancials.service.ts).

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

// What the seller is settled out of a customer amount at `percent` markup — the
// one formula for the markup split.
export function vendorShareOf(customerAmount: number, percent: number): number {
  return percent > 0 ? round2(customerAmount / (1 + percent / 100)) : round2(customerAmount);
}

// The platform's markup profit within a customer amount at `percent` markup.
export function markupProfitOf(customerAmount: number, percent: number): number {
  return round2(round2(customerAmount) - vendorShareOf(customerAmount, percent));
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

// What a create/update asks for.
export interface PricingRequest {
  sellingPrice?: number;
  // Admin-only, MARKUP sellers only.
  markupPercent?: number;
}

// Pulls the pricing fields out of a create/update body (removing them from it).
// The selling price may arrive as the product's price field (`price` Food /
// `sellingPrice` Instamart, as the apps have always sent it) or as
// `platformSellingPrice`. A vendorOriginalPrice from an older app is dropped —
// it is no longer a thing a seller sets.
export function pricingRequestFromInput(data: Record<string, unknown>, legacyKey: 'price' | 'sellingPrice'): PricingRequest {
  const take = (key: string): number | undefined => {
    const value = data[key];
    delete data[key];
    return typeof value === 'number' ? value : undefined;
  };
  take('vendorOriginalPrice');
  const platformSellingPrice = take('platformSellingPrice');
  const legacy = take(legacyKey);
  return { sellingPrice: platformSellingPrice ?? legacy, markupPercent: take('markupPercent') };
}

export function hasPricingRequest(request: PricingRequest): boolean {
  return request.sellingPrice !== undefined || request.markupPercent !== undefined;
}

// Applies a create/update to a product's stored pricing — the one place the
// price fields are written, so they cannot drift apart. The Selling Price is
// required (on create) and may never exceed the printed MRP. A product's
// markup % is admin-only and only exists on a MARKUP seller's product; the
// markup amount (the platform's profit per unit) follows from it. Under
// COMMISSION nothing about markup is stored.
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

  const sellingPrice = request.sellingPrice ?? doc[field];
  if (sellingPrice === undefined) throw ApiError.badRequest('Selling price is required', 'SELLING_PRICE_REQUIRED');

  if (typeof mrp === 'number' && mrp > 0 && sellingPrice > mrp + 0.005) {
    throw ApiError.unprocessable('Selling price cannot be greater than MRP.', 'SELLING_PRICE_ABOVE_MRP', { sellingPrice, mrp });
  }

  const markupPercent = request.markupPercent ?? doc.markupPercent ?? 0;
  doc[field] = sellingPrice;
  doc.markupPercent = markupPercent;
  doc.markupAmount = markup ? markupProfitOf(sellingPrice, markupPercent) : 0;
}

// Brings every product of a seller's stored markup amount back in line with its
// pricing model — called when the model changes (selling prices never change).
// A product keeps its markupPercent while the seller is on COMMISSION so
// switching back restores it, but its markup amount is 0.
export async function syncSellerProductPrices(owner: 'VENDOR' | 'STORE', sellerId: string): Promise<void> {
  const config = await loadPricingConfig(owner, sellerId);
  const markup = isMarkupModel(config);
  const isFood = owner === 'VENDOR';
  const field = isFood ? 'price' : 'sellingPrice';
  const products = isFood
    ? await VendorFoodItem.find({ vendorId: sellerId }).select('price markupPercent')
    : await InstamartProduct.find({ storeId: sellerId }).select('sellingPrice markupPercent');
  if (products.length === 0) return;

  const ops = products.map((product) => {
    const doc = product as unknown as Record<string, number | undefined>;
    const markupAmount = markup ? markupProfitOf(doc[field] as number, doc.markupPercent ?? 0) : 0;
    return { updateOne: { filter: { _id: product._id }, update: { $set: { markupAmount } } } };
  });
  if (isFood) await VendorFoodItem.bulkWrite(ops);
  else await InstamartProduct.bulkWrite(ops);
}

// --- Who sees which product fields ----------------------------------------------
// markupPercent / markupAmount are the platform's — only an admin sees them on a
// product; customers and sellers see MRP, selling price and discount.

const INTERNAL_PRODUCT_FIELDS = ['markupPercent', 'markupAmount', 'vendorOriginalPrice', 'platformSellingPrice'] as const;
const CUSTOMER_HIDDEN_PRODUCT_FIELDS = ['costPrice', 'minVariantPrice'] as const;

export function productForViewer<T extends Record<string, unknown>>(plain: T, userType: string): T {
  if (userType === 'ADMIN') return plain;
  const out: Record<string, unknown> = { ...plain };
  for (const field of INTERNAL_PRODUCT_FIELDS) delete out[field];
  if (userType === 'CUSTOMER') for (const field of CUSTOMER_HIDDEN_PRODUCT_FIELDS) delete out[field];
  return out as T;
}

// --- Redaction (orders) --------------------------------------------------------

// A customer or delivery partner reading an order (or its items) sees only what
// the customer paid. A vendor/store additionally sees its own settlement and the
// commission taken from it (the existing commission flow) — never the platform's
// markup, profit, revenue or costs. Admins see everything.
const SELLER_ONLY_FIELDS = [
  'pricingModel',
  'markupType',
  'markupValue',
  'vendorSettlementAmount',
  'commissionType',
  'commissionRate',
  'commissionBaseAmount',
  'commissionAmount',
  'commissionPercent',
  'vendorPayable',
  'refundRatio',
] as const;

const PLATFORM_ONLY_FIELDS = [
  'markupPercent',
  'markupAmount',
  'unitMarkupAmount',
  'vendorPrice',
  'vendorOriginalPrice',
  'vendorBaseAmount',
  'totalVendorAmount',
  'platformProfit',
  'platformRevenue',
  'adminProfit',
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

// A seller's settlement shows what it is owed and the commission taken (existing
// flow) — not the platform's markup deduction.
export function settlementForViewer<T>(data: T, userType: string): T {
  if (userType !== 'VENDOR' && userType !== 'STORE') return data;
  if (data === null || typeof data !== 'object') return data;
  if (Array.isArray(data)) return data.map((entry) => settlementForViewer(entry, userType)) as unknown as T;
  const source = data as unknown as { toJSON?: () => Record<string, unknown> };
  const plain = { ...(typeof source.toJSON === 'function' ? source.toJSON() : (data as Record<string, unknown>)) };
  delete plain.markupAmount;
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
// per product — see applyProductPricing.)
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
