import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { VendorFoodItem } from '../models/VendorFoodItem';
import { InstamartProduct } from '../models/InstamartProduct';
import { InstamartVariant } from '../models/InstamartVariant';
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
//   MARKUP — the platform's earning is a fixed per-product amount set by an
//     admin. The stored Selling Price is the seller's base price; customers pay
//     base price + markup amount, and the seller is settled their base price.
//
// A product's fixed markup amount also applies to its variants. Customers see
// base price + markup; the amount is snapshotted separately for platform
// earnings (see orderFinancials.service.ts).

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
  markupAmount?: number | null;
}

export function effectiveMarkupAmount(config: PricingConfig, product?: MarkupProduct): number {
  if (!isMarkupModel(config)) return 0;
  const amount = product?.markupAmount;
  return typeof amount === 'number' && amount > 0 ? round2(amount) : 0;
}

export function baseProductPrice(
  product: { pricingSchemaVersion?: number; markupAmount?: number | null },
  storedPrice: number,
): number {
  // Version 2 stored customer prices with the markup already included.
  if (product.pricingSchemaVersion === 2 && typeof product.markupAmount === 'number') {
    return round2(Math.max(0, storedPrice - product.markupAmount));
  }
  return round2(storedPrice);
}

export function customerPriceOf(basePrice: number, markupAmount: number): number {
  return round2(basePrice + markupAmount);
}

export function vendorShareOf(customerAmount: number, markupAmount: number): number {
  return round2(Math.max(0, customerAmount - markupAmount));
}

export function markupProfitOf(_basePrice: number, markupAmount: number): number {
  return round2(Math.max(0, markupAmount));
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
  // Admin-only fixed per-unit amount for MARKUP sellers.
  markupAmount?: number;
  // Temporary compatibility for older admin clients.
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
  return {
    sellingPrice: platformSellingPrice ?? legacy,
    markupAmount: take('markupAmount'),
    markupPercent: take('markupPercent'),
  };
}

export function hasPricingRequest(request: PricingRequest): boolean {
  return request.sellingPrice !== undefined || request.markupAmount !== undefined || request.markupPercent !== undefined;
}

// Applies a create/update to a product's stored pricing — the one place the
// price fields are written, so they cannot drift apart. The seller's base
// Selling Price is required (on create) and may never exceed the printed MRP.
// A product's fixed markup amount is admin-only and only applies to MARKUP.
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

  if (request.markupAmount !== undefined || request.markupPercent !== undefined) {
    if (user.userType !== 'ADMIN') throw ApiError.forbidden('Only the platform can set a product markup', 'MARKUP_ADMIN_ONLY');
    if (!markup) throw ApiError.badRequest('A product markup can only be set for a seller on the MARKUP pricing model', 'NOT_A_MARKUP_SELLER');
  }

  const storedPrice = doc[field];
  const previousBasePrice =
    storedPrice === undefined
      ? undefined
      : baseProductPrice(
          { pricingSchemaVersion: doc.pricingSchemaVersion, markupAmount: doc.markupAmount },
          storedPrice,
        );
  let sellingPrice = request.sellingPrice ?? previousBasePrice;
  if (sellingPrice === undefined) throw ApiError.badRequest('Selling price is required', 'SELLING_PRICE_REQUIRED');

  if (typeof mrp === 'number' && mrp > 0 && sellingPrice > mrp + 0.005) {
    throw ApiError.unprocessable('Selling price cannot be greater than MRP.', 'SELLING_PRICE_ABOVE_MRP', { sellingPrice, mrp });
  }

  let markupAmount = request.markupAmount ?? doc.markupAmount ?? 0;
  if (request.markupPercent !== undefined) {
    const legacyCustomerPrice = request.sellingPrice ?? storedPrice ?? sellingPrice;
    const legacyBasePrice = round2(legacyCustomerPrice / (1 + request.markupPercent / 100));
    markupAmount = round2(legacyCustomerPrice - legacyBasePrice);
    sellingPrice = legacyBasePrice;
  }
  doc[field] = sellingPrice;
  doc.markupPercent = 0;
  doc.markupAmount = markup ? round2(markupAmount) : 0;
  doc.pricingSchemaVersion = 3;
}

// Clear inactive markup amounts when switching to COMMISSION. Legacy version-2
// prices include that markup, so normalize product and variant prices first.
export async function syncSellerProductPrices(owner: 'VENDOR' | 'STORE', sellerId: string): Promise<void> {
  const config = await loadPricingConfig(owner, sellerId);
  const markup = isMarkupModel(config);
  const isFood = owner === 'VENDOR';
  if (markup) return;
  if (isFood) {
    const products = await VendorFoodItem.find({ vendorId: sellerId }).select('price markupAmount pricingSchemaVersion');
    const ops = products.map((product) => ({
      updateOne: {
        filter: { _id: product._id },
        update: {
          $set: {
            markupAmount: 0,
            ...(product.pricingSchemaVersion === 2
              ? { price: baseProductPrice(product, product.price), pricingSchemaVersion: 3 }
              : {}),
          },
        },
      },
    }));
    if (ops.length) await VendorFoodItem.bulkWrite(ops);
    return;
  }

  const products = await InstamartProduct.find({ storeId: sellerId }).select('sellingPrice markupAmount pricingSchemaVersion');
  const legacyProducts = products.filter((product) => product.pricingSchemaVersion === 2);
  if (legacyProducts.length) {
    const legacyById = new Map(legacyProducts.map((product) => [product.id, product]));
    const variants = await InstamartVariant.find({ productId: { $in: legacyProducts.map((product) => product._id) } }).select('productId sellingPrice');
    const variantOps = variants.map((variant) => {
      const product = legacyById.get(variant.productId.toString());
      if (!product) throw new Error(`Missing Instamart product ${variant.productId} while normalizing legacy variant pricing`);
      return {
        updateOne: {
          filter: { _id: variant._id },
          update: { $set: { sellingPrice: baseProductPrice(product, variant.sellingPrice) } },
        },
      };
    });
    if (variantOps.length) await InstamartVariant.bulkWrite(variantOps);
  }

  const ops = products.map((product) => ({
    updateOne: {
      filter: { _id: product._id },
      update: {
        $set: {
          markupAmount: 0,
          ...(product.pricingSchemaVersion === 2
            ? { sellingPrice: baseProductPrice(product, product.sellingPrice), pricingSchemaVersion: 3 }
            : {}),
        },
      },
    },
  }));
  if (ops.length) await InstamartProduct.bulkWrite(ops);
}

// --- Who sees which product fields ----------------------------------------------
// markupPercent / markupAmount are the platform's — only an admin sees them on a
// product; customers and sellers see MRP, selling price and discount.

const INTERNAL_PRODUCT_FIELDS = ['markupPercent', 'markupAmount', 'vendorOriginalPrice', 'platformSellingPrice'] as const;
const CUSTOMER_HIDDEN_PRODUCT_FIELDS = ['costPrice', 'minVariantPrice'] as const;

export function productForViewer<T extends Record<string, unknown>>(plain: T, userType: string): T {
  const out: Record<string, unknown> = { ...plain };
  const priceField = typeof out.price === 'number' ? 'price' : typeof out.sellingPrice === 'number' ? 'sellingPrice' : undefined;
  if (priceField) {
    const basePrice = baseProductPrice(
      {
        pricingSchemaVersion: out.pricingSchemaVersion as number | undefined,
        markupAmount: out.markupAmount as number | undefined,
      },
      out[priceField] as number,
    );
    out[priceField] = userType === 'CUSTOMER' ? customerPriceOf(basePrice, Number(out.markupAmount ?? 0)) : basePrice;
  }
  if (userType === 'ADMIN') return out as T;
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
