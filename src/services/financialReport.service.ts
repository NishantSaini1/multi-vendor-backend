import { Order } from '../models/Order';
import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { BUSINESS_TYPES, FOOD_ORDER_STATUS } from '../constants/orderStatus';
import { round2 } from './pricing.service';

// Platform financial reports, built from the per-order financial snapshots
// (see orderFinancials.service.ts) on DELIVERED orders — so they always show
// what was actually charged and settled at the time, never today's rates.
// Orders placed before the snapshot existed have no breakdown and are left out
// rather than counted with zeroed-out costs.

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

function matchStage(filter: Record<string, unknown>, range: { from?: Date; to?: Date }) {
  const match: Record<string, unknown> = { ...filter, status: FOOD_ORDER_STATUS.DELIVERED, platformNetProfit: { $exists: true } };
  if (range.from || range.to) {
    match.createdAt = { ...(range.from ? { $gte: range.from } : {}), ...(range.to ? { $lt: range.to } : {}) };
  }
  return match;
}

// One summary per business — Food and Instamart reported separately — plus the total.
export async function getFinancialReport(filter: Record<string, unknown>, range: { from?: Date; to?: Date }) {
  const rows = await Order.aggregate([{ $match: matchStage(filter, range) }, { $group: { _id: '$businessType', ...SUM_FIELDS } }]);
  const byBusiness = new Map<string, Record<string, unknown>>(rows.map((r) => [r._id as string, r]));
  const food = toSummary(byBusiness.get(BUSINESS_TYPES.FOOD));
  const instamart = toSummary(byBusiness.get(BUSINESS_TYPES.INSTAMART));
  return { [BUSINESS_TYPES.FOOD]: food, [BUSINESS_TYPES.INSTAMART]: instamart, total: addSummaries(food, instamart) };
}

// Vendor-level (Food) and store-level (Instamart) settlement: what each seller
// sold, what the platform took from it and how, and what it is owed.
export async function getSellerFinancials(filter: Record<string, unknown>, range: { from?: Date; to?: Date }) {
  const rows = await Order.aggregate([
    { $match: matchStage(filter, range) },
    {
      $group: {
        _id: { businessType: '$businessType', vendorId: '$vendorId', storeId: '$storeId' },
        pricingModel: { $last: '$pricingModel' },
        ...SUM_FIELDS,
      },
    },
    { $sort: { itemAmount: -1 } },
    { $limit: 500 },
  ]);

  const vendorIds = rows.map((r) => r._id.vendorId).filter(Boolean);
  const storeIds = rows.map((r) => r._id.storeId).filter(Boolean);
  const [vendors, stores] = await Promise.all([
    vendorIds.length ? Vendor.find({ _id: { $in: vendorIds } }).select('restaurantName') : [],
    storeIds.length ? Store.find({ _id: { $in: storeIds } }).select('name') : [],
  ]);
  const names = new Map<string, string>([
    ...vendors.map((v) => [v.id as string, v.restaurantName] as [string, string]),
    ...stores.map((s) => [s.id as string, s.name] as [string, string]),
  ]);

  return rows.map((row) => {
    const sellerId = String(row._id.vendorId ?? row._id.storeId);
    return {
      businessType: row._id.businessType as string,
      sellerType: row._id.vendorId ? 'VENDOR' : 'STORE',
      sellerId,
      sellerName: names.get(sellerId) ?? 'Unknown',
      pricingModel: row.pricingModel as string,
      ...toSummary(row),
    };
  });
}
