import { PipelineStage, Types } from 'mongoose';
import { Order } from '../models/Order';
import { OrderItem } from '../models/OrderItem';
import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { VendorFoodItem } from '../models/VendorFoodItem';
import { InstamartProduct } from '../models/InstamartProduct';
import { FoodProduct } from '../models/FoodProduct';
import { FoodCategory } from '../models/FoodCategory';
import { InstamartCategory } from '../models/InstamartCategory';
import { BUSINESS_TYPES, FOOD_ORDER_STATUS } from '../constants/orderStatus';
import { PRICING_MODELS } from '../constants/enums';
import { round2 } from './pricing.service';

// Platform financial reports, built from the per-order financial snapshots
// (see orderFinancials.service.ts) — so they always show what was actually
// charged and settled at the time, never today's rates or markups. Orders
// placed before the snapshot existed have no breakdown and are left out rather
// than counted with zeroed-out costs.
//
// Two layers:
//   • getFinancialReport — whole-platform P&L, Food and Instamart apart.
//   • seller → product → order profit reports (getSellerFinancials,
//     getSellerProducts, getSellerOrders), built from the order-item snapshots.
//     Markup is set per product but reported per seller, and MARKUP PROFIT is
//     always kept apart from COMMISSION REVENUE.

const ID_FIELDS = new Set(['locationId', 'vendorId', 'storeId', 'productId', 'orderId', 'customerId']);

// $match inside an aggregation doesn't cast ids the way find() does, so string
// ids (from a query string or a JWT) must be turned into ObjectIds first.
function castIds(filter: Record<string, unknown>): Record<string, unknown> {
  const cast = (value: unknown): unknown => {
    if (typeof value === 'string' && Types.ObjectId.isValid(value) && value.length === 24) return new Types.ObjectId(value);
    if (Array.isArray(value)) return value.map(cast);
    return value;
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (ID_FIELDS.has(key)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([op, v]) => [op, cast(v)]));
      } else out[key] = cast(value);
    } else out[key] = value;
  }
  return out;
}

export interface DateRange {
  from?: Date;
  to?: Date;
}

export interface FinancialSummary {
  orders: number;
  // Item sales at the prices customers paid, before discounts.
  grossSales: number;
  // Seller-funded item discounts and platform-funded coupons.
  itemDiscounts: number;
  couponDiscounts: number;
  // Customer-paid item amount after item discounts (what commission/markup is taken on).
  itemAmount: number;
  vendorSettlement: number;
  commissionRevenue: number;
  markupRevenue: number;
  deliveryRevenue: number;
  // Collected on the government's behalf — not revenue.
  taxCollected: number;
  paymentGatewayCharges: number;
  deliveryPartnerPayout: number;
  // Gateway charges + delivery partner payouts + platform-funded coupons.
  platformExpenses: number;
  netProfit: number;
}

const SUM_FIELDS = {
  orders: { $sum: 1 },
  grossSales: { $sum: '$subtotal' },
  itemDiscounts: { $sum: { $ifNull: ['$discount', 0] } },
  couponDiscounts: { $sum: { $ifNull: ['$couponDiscount', 0] } },
  itemAmount: { $sum: '$customerPrice' },
  vendorSettlement: { $sum: '$vendorSettlementAmount' },
  commissionRevenue: { $sum: { $ifNull: ['$commissionAmount', 0] } },
  markupRevenue: { $sum: { $ifNull: ['$markupAmount', 0] } },
  deliveryRevenue: { $sum: { $ifNull: ['$deliveryRevenue', 0] } },
  taxCollected: { $sum: { $ifNull: ['$tax', 0] } },
  paymentGatewayCharges: { $sum: { $ifNull: ['$paymentGatewayFee', 0] } },
  deliveryPartnerPayout: { $sum: { $ifNull: ['$deliveryPartnerPayout', 0] } },
  platformExpenses: { $sum: { $ifNull: ['$platformExpenses', 0] } },
  netProfit: { $sum: { $ifNull: ['$platformNetProfit', 0] } },
};

const emptySummary = (): FinancialSummary => ({
  orders: 0,
  grossSales: 0,
  itemDiscounts: 0,
  couponDiscounts: 0,
  itemAmount: 0,
  vendorSettlement: 0,
  commissionRevenue: 0,
  markupRevenue: 0,
  deliveryRevenue: 0,
  taxCollected: 0,
  paymentGatewayCharges: 0,
  deliveryPartnerPayout: 0,
  platformExpenses: 0,
  netProfit: 0,
});

function toSummary(row: Record<string, unknown> | undefined): FinancialSummary {
  const summary = emptySummary();
  if (!row) return summary;
  for (const key of Object.keys(summary) as (keyof FinancialSummary)[]) {
    const value = row[key];
    if (typeof value === 'number') summary[key] = key === 'orders' ? value : round2(value);
  }
  return summary;
}

function addSummaries(a: FinancialSummary, b: FinancialSummary): FinancialSummary {
  const out = emptySummary();
  for (const key of Object.keys(out) as (keyof FinancialSummary)[]) out[key] = key === 'orders' ? a[key] + b[key] : round2(a[key] + b[key]);
  return out;
}

function matchStage(filter: Record<string, unknown>, range: DateRange) {
  const match: Record<string, unknown> = { ...castIds(filter), status: FOOD_ORDER_STATUS.DELIVERED, platformNetProfit: { $exists: true } };
  if (range.from || range.to) {
    match.createdAt = { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lt: range.to } : {}) };
  }
  return match;
}

// One summary per business — Food and Instamart reported separately — plus the total.
export async function getFinancialReport(filter: Record<string, unknown>, range: DateRange) {
  const rows = await Order.aggregate([{ $match: matchStage(filter, range) }, { $group: { _id: '$businessType', ...SUM_FIELDS } }]);
  const byBusiness = new Map<string, Record<string, unknown>>(rows.map((r) => [r._id as string, r]));
  const food = toSummary(byBusiness.get(BUSINESS_TYPES.FOOD));
  const instamart = toSummary(byBusiness.get(BUSINESS_TYPES.INSTAMART));
  return { [BUSINESS_TYPES.FOOD]: food, [BUSINESS_TYPES.INSTAMART]: instamart, total: addSummaries(food, instamart) };
}

// --- Seller → product → order profit reports ----------------------------------

export interface ProfitFilters {
  // Location scope etc. (an admin's own scope) — never from the query string.
  scope: Record<string, unknown>;
  businessType?: string;
  sellerId?: string;
  productId?: string;
  categoryId?: string;
  pricingModel?: string;
  // An order status, or 'ALL'. Defaults to DELIVERED (realised profit).
  status?: string;
  range: DateRange;
}

export interface ProfitMetrics {
  itemsSold: number;
  // What the seller is paid for the items (their original price under MARKUP,
  // the sale minus commission under COMMISSION).
  vendorCost: number;
  // What customers paid for the items, net of item discounts.
  customerSales: number;
  // MARKUP PROFIT — the markup baked into the price (MARKUP sellers only).
  markupProfit: number;
  // COMMISSION REVENUE — the commission kept (COMMISSION sellers only).
  commissionRevenue: number;
  // markupProfit + commissionRevenue. vendorCost + adminProfit = customerSales.
  adminProfit: number;
}

const emptyMetrics = (): ProfitMetrics => ({ itemsSold: 0, vendorCost: 0, customerSales: 0, markupProfit: 0, commissionRevenue: 0, adminProfit: 0 });

const ITEM_SUMS = {
  itemsSold: { $sum: '$quantity' },
  vendorCost: { $sum: { $ifNull: ['$vendorSettlementAmount', 0] } },
  customerSales: { $sum: { $ifNull: ['$totalSellingAmount', 0] } },
  markupProfit: { $sum: { $ifNull: ['$markupAmount', 0] } },
  commissionRevenue: { $sum: { $ifNull: ['$commissionAmount', 0] } },
};

function toMetrics(row: Record<string, unknown>): ProfitMetrics {
  const m = emptyMetrics();
  for (const key of ['itemsSold', 'vendorCost', 'customerSales', 'markupProfit', 'commissionRevenue'] as const) {
    const value = row[key];
    m[key] = typeof value === 'number' ? (key === 'itemsSold' ? value : round2(value)) : 0;
  }
  m.adminProfit = round2(m.markupProfit + m.commissionRevenue);
  return m;
}

function sumMetrics(rows: ProfitMetrics[]): ProfitMetrics {
  const total = emptyMetrics();
  for (const r of rows) {
    total.itemsSold += r.itemsSold;
    total.vendorCost = round2(total.vendorCost + r.vendorCost);
    total.customerSales = round2(total.customerSales + r.customerSales);
    total.markupProfit = round2(total.markupProfit + r.markupProfit);
    total.commissionRevenue = round2(total.commissionRevenue + r.commissionRevenue);
    total.adminProfit = round2(total.adminProfit + r.adminProfit);
  }
  return total;
}

// Product ids (the listing ids order items carry) in a category, across Food and Instamart.
async function productIdsInCategory(categoryId: string): Promise<Types.ObjectId[]> {
  const foodGlobals = await FoodProduct.find({ categoryId }).distinct('_id');
  const [foodListings, martListings] = await Promise.all([
    foodGlobals.length ? VendorFoodItem.find({ globalFoodItemId: { $in: foodGlobals } }).distinct('_id') : [],
    InstamartProduct.find({ categoryId }).distinct('_id'),
  ]);
  return [...foodListings, ...martListings] as Types.ObjectId[];
}

// Order-item aggregation, joined to its order and filtered by everything in
// ProfitFilters. Only order items carrying the pricing snapshot count.
async function itemPipeline(filters: ProfitFilters): Promise<PipelineStage[]> {
  const itemMatch: Record<string, unknown> = { totalSellingAmount: { $exists: true } };
  if (filters.productId) itemMatch.productId = new Types.ObjectId(filters.productId);
  if (filters.categoryId) itemMatch.productId = { $in: await productIdsInCategory(filters.categoryId) };

  const orderMatch: Record<string, unknown> = { ...castIds(filters.scope), platformNetProfit: { $exists: true } };
  if (filters.status !== 'ALL') orderMatch.status = filters.status ?? FOOD_ORDER_STATUS.DELIVERED;
  if (filters.businessType) orderMatch.businessType = filters.businessType;
  if (filters.pricingModel) orderMatch.pricingModel = filters.pricingModel;
  if (filters.sellerId) {
    const id = new Types.ObjectId(filters.sellerId);
    orderMatch.$or = [{ vendorId: id }, { storeId: id }];
  }
  if (filters.range.from || filters.range.to) {
    orderMatch.createdAt = { ...(filters.range.from ? { $gte: filters.range.from } : {}), ...(filters.range.to ? { $lt: filters.range.to } : {}) };
  }

  return [
    { $match: itemMatch },
    { $lookup: { from: 'orders', localField: 'orderId', foreignField: '_id', as: 'order' } },
    { $unwind: '$order' },
    // The order's own fields, prefixed, for matching.
    { $match: Object.fromEntries(Object.entries(orderMatch).map(([k, v]) => (k === '$or' ? [k, (v as Record<string, unknown>[]).map((c) => Object.fromEntries(Object.entries(c).map(([ck, cv]) => [`order.${ck}`, cv])))] : [`order.${k}`, v]))) },
  ];
}

export interface SellerProfitRow extends ProfitMetrics {
  businessType: string;
  sellerType: 'VENDOR' | 'STORE';
  sellerId: string;
  sellerName: string;
  // A seller that changed model over the period appears once per model, so the
  // two kinds of profit never blur together.
  pricingModel: string;
  // Products the seller currently lists.
  totalProducts: number;
  totalOrders: number;
}

// Store/vendor-wise profit: for each seller (and pricing model), what it sold,
// what it costs the platform and what the platform earned from it.
export async function getSellerFinancials(filters: ProfitFilters) {
  const rows = await OrderItem.aggregate([
    ...(await itemPipeline(filters)),
    // One row per (seller, model, order) first so orders are counted once…
    {
      $group: {
        _id: { businessType: '$order.businessType', vendorId: '$order.vendorId', storeId: '$order.storeId', pricingModel: '$order.pricingModel', orderId: '$orderId' },
        ...ITEM_SUMS,
      },
    },
    // …then roll those up per seller (and model).
    {
      $group: {
        _id: { businessType: '$_id.businessType', vendorId: '$_id.vendorId', storeId: '$_id.storeId', pricingModel: '$_id.pricingModel' },
        totalOrders: { $sum: 1 },
        itemsSold: { $sum: '$itemsSold' },
        vendorCost: { $sum: '$vendorCost' },
        customerSales: { $sum: '$customerSales' },
        markupProfit: { $sum: '$markupProfit' },
        commissionRevenue: { $sum: '$commissionRevenue' },
      },
    },
    { $sort: { customerSales: -1 } },
    { $limit: 500 },
  ]);

  const vendorIds = rows.map((r) => r._id.vendorId).filter(Boolean);
  const storeIds = rows.map((r) => r._id.storeId).filter(Boolean);
  const [vendors, stores, foodCounts, martCounts] = await Promise.all([
    vendorIds.length ? Vendor.find({ _id: { $in: vendorIds } }).select('restaurantName') : [],
    storeIds.length ? Store.find({ _id: { $in: storeIds } }).select('name') : [],
    vendorIds.length ? VendorFoodItem.aggregate([{ $match: { vendorId: { $in: vendorIds } } }, { $group: { _id: '$vendorId', n: { $sum: 1 } } }]) : [],
    storeIds.length ? InstamartProduct.aggregate([{ $match: { storeId: { $in: storeIds } } }, { $group: { _id: '$storeId', n: { $sum: 1 } } }]) : [],
  ]);
  const names = new Map<string, string>([
    ...vendors.map((v) => [v.id as string, v.restaurantName] as [string, string]),
    ...stores.map((s) => [s.id as string, s.name] as [string, string]),
  ]);
  const productCounts = new Map<string, number>([...foodCounts, ...martCounts].map((c) => [String(c._id), c.n as number]));

  const result: SellerProfitRow[] = rows.map((row) => {
    const sellerId = String(row._id.vendorId ?? row._id.storeId);
    return {
      businessType: row._id.businessType as string,
      sellerType: row._id.vendorId ? 'VENDOR' : 'STORE',
      sellerId,
      sellerName: names.get(sellerId) ?? 'Unknown',
      pricingModel: row._id.pricingModel as string,
      totalProducts: productCounts.get(sellerId) ?? 0,
      totalOrders: row.totalOrders as number,
      ...toMetrics(row),
    };
  });
  return { rows: result, totals: sumMetrics(result) };
}

// --- A seller's own view ------------------------------------------------------
// What a vendor/store may see of its own sales: what customers paid, what it is
// paid, and the commission or markup applied — never the platform's profit.

export interface SellerEarningsMetrics {
  itemsSold: number;
  // What customers paid for the items, net of item discounts.
  customerPaid: number;
  // What the seller is paid for them.
  youReceive: number;
  // Commission taken (COMMISSION model).
  commission: number;
  // Markup added on top of the seller's price (MARKUP model) — the seller still
  // receives its own price.
  markup: number;
}

function toSellerMetrics(m: ProfitMetrics): SellerEarningsMetrics {
  return { itemsSold: m.itemsSold, customerPaid: m.customerSales, youReceive: m.vendorCost, commission: m.commissionRevenue, markup: m.markupProfit };
}

function sumSellerMetrics(rows: SellerEarningsMetrics[]): SellerEarningsMetrics {
  const total: SellerEarningsMetrics = { itemsSold: 0, customerPaid: 0, youReceive: 0, commission: 0, markup: 0 };
  for (const r of rows) {
    total.itemsSold += r.itemsSold;
    total.customerPaid = round2(total.customerPaid + r.customerPaid);
    total.youReceive = round2(total.youReceive + r.youReceive);
    total.commission = round2(total.commission + r.commission);
    total.markup = round2(total.markup + r.markup);
  }
  return total;
}

function ownFilters(sellerId: string, query: { productId?: string; status?: string; from?: string; to?: string }): ProfitFilters {
  const range: DateRange = {};
  if (query.from) range.from = new Date(query.from);
  if (query.to) range.to = new Date(query.to);
  return { scope: {}, sellerId, productId: query.productId, status: query.status, range };
}

// Totals for the logged-in seller, split by pricing model so a seller that
// changed model sees each period on its own terms.
export async function getOwnEarningsSummary(sellerId: string, query: { status?: string; from?: string; to?: string }) {
  const { rows } = await getSellerFinancials(ownFilters(sellerId, query));
  const byModel = rows.map((r) => ({ pricingModel: r.pricingModel, orders: r.totalOrders, productsListed: r.totalProducts, ...toSellerMetrics(r) }));
  return {
    orders: byModel.reduce((n, r) => n + r.orders, 0),
    productsListed: byModel[0]?.productsListed ?? 0,
    totals: sumSellerMetrics(byModel),
    byModel,
  };
}

export async function getOwnProductEarnings(sellerId: string, query: { productId?: string; status?: string; from?: string; to?: string }) {
  const { rows } = await getSellerProducts(ownFilters(sellerId, query));
  const mapped = rows.map((r) => ({
    productId: r.productId,
    name: r.name,
    pricingModel: r.pricingModel,
    orders: r.orders,
    markupPercent: r.markupPercent,
    ...toSellerMetrics(r),
  }));
  return { rows: mapped, totals: sumSellerMetrics(mapped) };
}

export async function getOwnOrderEarnings(sellerId: string, query: { productId?: string; status?: string; from?: string; to?: string }, limit = 100) {
  const { rows } = await getSellerOrders(ownFilters(sellerId, query), limit);
  const mapped = rows.map((r) => ({
    orderId: r.orderId,
    orderNumber: r.orderNumber,
    createdAt: r.createdAt,
    status: r.status,
    pricingModel: r.pricingModel,
    ...toSellerMetrics(r),
  }));
  return { rows: mapped, totals: sumSellerMetrics(mapped) };
}

export interface ProductProfitRow extends ProfitMetrics {
  productId: string;
  name: string;
  pricingModel: string;
  orders: number;
  // Weighted markup % actually charged over the period (from the order
  // snapshots) — 0 for COMMISSION sales.
  markupPercent: number;
  // The product as listed NOW — it can differ from what was charged then.
  current?: { vendorPrice: number; markupPercent: number; sellingPrice: number; categoryId?: string; categoryName?: string };
}

async function currentListings(productIds: Types.ObjectId[]) {
  const [foodItems, martItems] = await Promise.all([
    VendorFoodItem.find({ _id: { $in: productIds } }).select('price markupPercent platformSellingPrice globalFoodItemId'),
    InstamartProduct.find({ _id: { $in: productIds } }).select('sellingPrice markupPercent platformSellingPrice categoryId'),
  ]);
  const globals = foodItems.length ? await FoodProduct.find({ _id: { $in: foodItems.map((i) => i.globalFoodItemId) } }).select('categoryId') : [];
  const globalCategory = new Map(globals.map((g) => [g.id as string, g.categoryId?.toString()]));
  const categoryIds = new Set<string>([...globalCategory.values(), ...martItems.map((m) => m.categoryId?.toString())].filter(Boolean) as string[]);
  const [foodCats, martCats] = await Promise.all([
    categoryIds.size ? FoodCategory.find({ _id: { $in: [...categoryIds] } }).select('name') : [],
    categoryIds.size ? InstamartCategory.find({ _id: { $in: [...categoryIds] } }).select('name') : [],
  ]);
  const categoryName = new Map<string, string>([...foodCats, ...martCats].map((c) => [c.id as string, c.name]));

  const info = new Map<string, NonNullable<ProductProfitRow['current']>>();
  for (const item of foodItems) {
    const categoryId = globalCategory.get(item.globalFoodItemId.toString());
    info.set(item.id, {
      vendorPrice: item.price,
      markupPercent: item.markupPercent ?? 0,
      sellingPrice: item.platformSellingPrice ?? item.price,
      categoryId,
      categoryName: categoryId ? categoryName.get(categoryId) : undefined,
    });
  }
  for (const item of martItems) {
    const categoryId = item.categoryId?.toString();
    info.set(item.id, {
      vendorPrice: item.sellingPrice,
      markupPercent: item.markupPercent ?? 0,
      sellingPrice: item.platformSellingPrice ?? item.sellingPrice,
      categoryId,
      categoryName: categoryId ? categoryName.get(categoryId) : undefined,
    });
  }
  return info;
}

// Product-level profit within a seller (or across sellers when none is given).
export async function getSellerProducts(filters: ProfitFilters) {
  const rows = await OrderItem.aggregate([
    ...(await itemPipeline(filters)),
    {
      $group: {
        _id: { productId: '$productId', pricingModel: '$order.pricingModel' },
        name: { $last: '$name' },
        orderIds: { $addToSet: '$orderId' },
        ...ITEM_SUMS,
      },
    },
    { $sort: { customerSales: -1 } },
    { $limit: 500 },
  ]);

  const current = await currentListings(rows.map((r) => r._id.productId as Types.ObjectId));
  const result: ProductProfitRow[] = rows.map((row) => {
    const metrics = toMetrics(row);
    // Vendor base the markup was added to = what the vendor was paid under MARKUP.
    const markupPercent = row._id.pricingModel === PRICING_MODELS.MARKUP && metrics.vendorCost > 0 ? round2((metrics.markupProfit / metrics.vendorCost) * 100) : 0;
    return {
      productId: String(row._id.productId),
      name: row.name as string,
      pricingModel: row._id.pricingModel as string,
      orders: (row.orderIds as unknown[]).length,
      markupPercent,
      current: current.get(String(row._id.productId)),
      ...metrics,
    };
  });
  return { rows: result, totals: sumMetrics(result) };
}

export interface OrderProfitRow extends ProfitMetrics {
  orderId: string;
  orderNumber: string;
  createdAt: Date;
  status: string;
  businessType: string;
  pricingModel: string;
}

// Order-level profit — the orders behind a seller's/product's numbers.
export async function getSellerOrders(filters: ProfitFilters, limit = 100) {
  const rows = await OrderItem.aggregate([
    ...(await itemPipeline(filters)),
    {
      $group: {
        _id: '$orderId',
        orderNumber: { $first: '$order.orderNumber' },
        createdAt: { $first: '$order.createdAt' },
        status: { $first: '$order.status' },
        businessType: { $first: '$order.businessType' },
        pricingModel: { $first: '$order.pricingModel' },
        ...ITEM_SUMS,
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: Math.min(Math.max(limit, 1), 500) },
  ]);

  const result: OrderProfitRow[] = rows.map((row) => ({
    orderId: String(row._id),
    orderNumber: row.orderNumber as string,
    createdAt: row.createdAt as Date,
    status: row.status as string,
    businessType: row.businessType as string,
    pricingModel: row.pricingModel as string,
    ...toMetrics(row),
  }));
  return { rows: result, totals: sumMetrics(result) };
}
