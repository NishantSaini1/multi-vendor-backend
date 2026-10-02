import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { VendorFoodItem } from '../models/VendorFoodItem';
import { InstamartProduct } from '../models/InstamartProduct';
import { ApiError } from '../utils/ApiError';
import { JwtPayload } from '../utils/jwt';
import { assertOwnerOrLocationAccess } from '../middleware/rbac.middleware';
import { DISCOUNT_TYPES, PRICING_MODELS } from '../constants/enums';

// Vendor/store pricing models (see PRICING_MODELS in enums.ts). One model is
// chosen per vendor/store and applies to EVERY item it sells, Food or
// Instamart alike — never per product.
//
//   COMMISSION — the customer pays the seller's own price; the platform keeps
//     the vendor profile's `commissionPercent` of each item and the rest is
//     settled to the seller.
//   MARKUP — no commission. The platform lists each item at a platform selling
//     price above the seller's original price; the seller is settled their
//     original price in full and the difference (markupAmount) is the
//     platform's revenue. e.g. original ₹100, platform price ₹120 → customer
//     pays ₹120, seller gets ₹100, platform earns ₹20.
//
// A MARKUP item's platform price is either fixed by an admin
// (platformPriceManual) or, by default, derived from the seller's default
// markup (markupType/markupValue). This module owns that price math; the
// per-order money math lives in orderFinancials.service.ts. Catalog listings
// (what a customer sees), the cart/checkout (what a customer pays) and the
// order snapshot (what gets settled) all go through these two, so they can
// never disagree.

export interface PricingConfig {
  pricingModel: string;
  commissionPercent?: number;
  // Default markup: derives the platform price of any item an admin hasn't
  // priced by hand (and of every variant/add-on, which are never hand-priced).
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

export function toPricingConfig(
  source: { pricingModel?: string; commissionPercent?: number | null; markupType?: string; markupValue?: number } | null | undefined,
): PricingConfig {
  if (!source) return DEFAULT_PRICING_CONFIG;
  return {
    pricingModel: source.pricingModel ?? PRICING_MODELS.COMMISSION,
    commissionPercent: typeof source.commissionPercent === 'number' ? source.commissionPercent : undefined,
    markupType: source.markupType ?? DISCOUNT_TYPES.PERCENTAGE,
    markupValue: source.markupValue ?? 0,
  };
}

export function isMarkupModel(config: PricingConfig): boolean {
  return config.pricingModel === PRICING_MODELS.MARKUP;
}

// What a MARKUP seller's default markup turns ONE unit at `vendorPrice` into.
// A flat markup is per unit.
export function customerUnitPrice(vendorPrice: number, config: PricingConfig): number {
  if (!isMarkupModel(config) || !(config.markupValue > 0)) return vendorPrice;
  if (config.markupType === DISCOUNT_TYPES.PERCENTAGE) return round2(vendorPrice * (1 + config.markupValue / 100));
  return round2(vendorPrice + config.markupValue);
}

// Modifier/add-on prices only carry a percentage markup — a flat markup is
// already charged once per unit on the item itself, so adding it to every
// add-on as well would double-charge.
export function customerModifierPrice(vendorPrice: number, config: PricingConfig): number {
  if (!isMarkupModel(config) || config.markupType !== DISCOUNT_TYPES.PERCENTAGE || !(config.markupValue > 0)) return vendorPrice;
  return round2(vendorPrice * (1 + config.markupValue / 100));
}

interface PlatformPricedProduct {
  platformSellingPrice?: number | null;
  platformPriceManual?: boolean;
}

// The platform selling price of a product's own (base) price — the single
// rule the listings, cart and checkout all use. An admin-fixed price wins
// (never below the seller's own price, so markup can't go negative);
// otherwise it follows the seller's default markup, computed fresh so a
// change to that markup applies at once. COMMISSION sellers sell at their own
// price. Variants are never hand-priced: they use customerUnitPrice().
export function platformPriceFor(vendorPrice: number, config: PricingConfig, product?: PlatformPricedProduct): number {
  if (!isMarkupModel(config)) return vendorPrice;
  if (product?.platformPriceManual && typeof product.platformSellingPrice === 'number') {
    return round2(Math.max(product.platformSellingPrice, vendorPrice));
  }
  return customerUnitPrice(vendorPrice, config);
}

// The denormalised fields stored on a product for display/reporting.
export function derivePlatformFields(vendorPrice: number, config: PricingConfig, product?: PlatformPricedProduct) {
  const platformSellingPrice = platformPriceFor(vendorPrice, config, product);
  return { platformSellingPrice, markupAmount: round2(platformSellingPrice - vendorPrice) };
}

// Applies an item's create/update to its stored platform-price fields. Only an
// admin may fix the platform price by hand (`requested`: a price, or null to
// release it back to the seller's default markup), and only for a MARKUP
// seller, and never below the seller's own price.
export function applyProductPlatformPrice(
  product: { platformSellingPrice?: number | null; markupAmount: number; platformPriceManual: boolean },
  vendorPrice: number,
  config: PricingConfig,
  user: JwtPayload,
  requested?: number | null,
): void {
  if (requested !== undefined) {
    if (user.userType !== 'ADMIN') {
      throw ApiError.forbidden('Only the platform can set a platform selling price', 'PLATFORM_PRICE_ADMIN_ONLY');
    }
    if (!isMarkupModel(config)) {
      throw ApiError.badRequest('A platform selling price can only be set for a seller on the MARKUP pricing model', 'NOT_A_MARKUP_SELLER');
    }
    if (requested === null) {
      product.platformPriceManual = false;
      product.platformSellingPrice = undefined;
    } else {
      if (requested < vendorPrice) {
        throw ApiError.badRequest("The platform selling price cannot be below the seller's own price", 'PLATFORM_PRICE_BELOW_VENDOR_PRICE');
      }
      product.platformSellingPrice = requested;
      product.platformPriceManual = true;
    }
  }
  const derived = derivePlatformFields(vendorPrice, config, product);
  product.platformSellingPrice = derived.platformSellingPrice;
  product.markupAmount = derived.markupAmount;
  if (!isMarkupModel(config)) product.platformPriceManual = false;
}

export async function loadPricingConfigs(owner: 'VENDOR' | 'STORE', ids: string[]): Promise<Map<string, PricingConfig>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const query = { _id: { $in: unique } };
  const fields = 'pricingModel commissionPercent markupType markupValue';
  const docs = owner === 'VENDOR' ? await Vendor.find(query).select(fields) : await Store.find(query).select(fields);
  return new Map(docs.map((d) => [d.id as string, toPricingConfig(d)]));
}

export async function loadPricingConfig(owner: 'VENDOR' | 'STORE', id: string): Promise<PricingConfig> {
  return (await loadPricingConfigs(owner, [id])).get(id) ?? DEFAULT_PRICING_CONFIG;
}

// Brings every product of a seller back in line with its current pricing model
// — called whenever the model / default markup changes. Products an admin
// priced by hand keep their price while the seller stays on MARKUP; moving to
// COMMISSION releases them (the seller sells at its own price again).
export async function syncSellerProductPrices(owner: 'VENDOR' | 'STORE', sellerId: string): Promise<void> {
  const config = await loadPricingConfig(owner, sellerId);
  const isFood = owner === 'VENDOR';
  const products = isFood
    ? await VendorFoodItem.find({ vendorId: sellerId }).select('price platformSellingPrice platformPriceManual')
    : await InstamartProduct.find({ storeId: sellerId }).select('sellingPrice platformSellingPrice platformPriceManual');
  if (products.length === 0) return;

  const ops = products.map((product) => {
    const vendorPrice = isFood ? (product as unknown as { price: number }).price : (product as unknown as { sellingPrice: number }).sellingPrice;
    const manual = isMarkupModel(config) && product.platformPriceManual;
    return {
      updateOne: {
        filter: { _id: product._id },
        update: { $set: { ...derivePlatformFields(vendorPrice, config, product), platformPriceManual: manual } },
      },
    };
  });
  if (isFood) await VendorFoodItem.bulkWrite(ops);
  else await InstamartProduct.bulkWrite(ops);
}

// --- Customer-facing listing transforms ---------------------------------
// Each takes a plain object (already `.toObject()`/lean) and rewrites its
// price fields to what a CUSTOMER should see, and drops the platform-pricing
// internals. Callers apply them only for CUSTOMER requests — vendor/store/
// admin views keep the raw prices.

const PLATFORM_PRICING_FIELDS = ['platformSellingPrice', 'markupAmount', 'platformPriceManual'] as const;

function stripPlatformPricing<T extends Record<string, unknown>>(plain: T): T {
  const out: Record<string, unknown> = { ...plain };
  for (const field of PLATFORM_PRICING_FIELDS) delete out[field];
  return out as T;
}

export function markupFoodItem<T extends Record<string, unknown>>(plain: T, config: PricingConfig): T {
  if (!isMarkupModel(config)) return stripPlatformPricing(plain);
  const price = platformPriceFor(plain.price as number, config, plain as PlatformPricedProduct);
  const mrp = plain.mrp as number | undefined;
  return stripPlatformPricing({ ...plain, price, ...(mrp !== undefined && mrp !== null ? { mrp: Math.max(mrp, price) } : {}) });
}

export function markupFoodVariant<T extends Record<string, unknown>>(plain: T, config: PricingConfig): T {
  if (!isMarkupModel(config)) return plain;
  const price = customerUnitPrice(plain.price as number, config);
  const mrp = plain.mrp as number | undefined;
  return { ...plain, price, ...(mrp !== undefined && mrp !== null ? { mrp: Math.max(mrp, price) } : {}) };
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
  if (!isMarkupModel(config)) return stripPlatformPricing(plain);
  const base = plain.sellingPrice as number;
  const platformBase = platformPriceFor(base, config, plain as PlatformPricedProduct);
  const out: Record<string, unknown> = { ...plain, sellingPrice: platformBase };

  // Fields added by instamartProduct.service's attachVariantInfo. They hold
  // either the base pack's price (variantIdFrom null) or a variant's — the
  // base uses the platform price above, a variant the seller's default markup.
  if (typeof plain.variantPriceFrom === 'number') {
    out.variantPriceFrom = plain.variantIdFrom ? customerUnitPrice(plain.variantPriceFrom, config) : platformBase;
  }
  if (typeof plain.minPackPrice === 'number') {
    const markedMin = plain.minPackPrice < base ? customerUnitPrice(plain.minPackPrice, config) : platformBase;
    out.minPackPrice = Math.min(markedMin, platformBase);
  }
  return stripPlatformPricing(out) as T;
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
  'vendorBaseAmount',
  'markupAmount',
  'vendorSettlementAmount',
  'commissionType',
  'commissionRate',
  'commissionBaseAmount',
  'commissionAmount',
  'vendorPrice',
] as const;

const PLATFORM_ONLY_FIELDS = [
  'platformProfit',
  'platformRevenue',
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
  markupType?: string;
  markupValue?: number;
}

// A seller may choose its own pricing MODEL, but the rates — the commission %
// the platform charges and the default markup it adds — are the platform's to
// set, so only an admin can change them.
function applyPricingInput(
  target: { pricingModel: string; commissionPercent?: number; markupType: string; markupValue: number },
  input: UpdatePricingInput,
  user: JwtPayload,
) {
  const touchesRates = input.commissionPercent !== undefined || input.markupType !== undefined || input.markupValue !== undefined;
  if (touchesRates && user.userType !== 'ADMIN') {
    throw ApiError.forbidden('Only the platform can set commission and markup rates', 'PRICING_RATES_ADMIN_ONLY');
  }

  if (input.pricingModel !== undefined) target.pricingModel = input.pricingModel;
  if (input.commissionPercent !== undefined) target.commissionPercent = input.commissionPercent ?? undefined;
  if (input.markupType !== undefined) target.markupType = input.markupType;
  if (input.markupValue !== undefined) target.markupValue = input.markupValue;

  if (target.markupType === DISCOUNT_TYPES.PERCENTAGE && target.markupValue > 500) {
    throw ApiError.badRequest('A percentage markup cannot exceed 500%', 'MARKUP_TOO_HIGH');
  }
}

function describe(doc: { id?: string; pricingModel: string; commissionPercent?: number; markupType: string; markupValue: number }, name: string) {
  return { id: doc.id as string, name, ...toPricingConfig(doc) };
}

export async function getVendorPricing(vendorId: string, user: JwtPayload) {
  const vendor = await Vendor.findById(vendorId).select('restaurantName locationId pricingModel commissionPercent markupType markupValue');
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
  const store = await Store.findById(storeId).select('name locationId pricingModel commissionPercent markupType markupValue');
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
