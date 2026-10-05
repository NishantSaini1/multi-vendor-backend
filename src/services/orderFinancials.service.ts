import { env } from '../config/env';
import { DISCOUNT_TYPES, PRICING_MODELS } from '../constants/enums';
import { PAYMENT_METHODS } from '../constants/paymentStatus';
import * as commissionService from './commission.service';
import { PricingConfig, customerPriceOf, effectiveMarkupAmount, isMarkupModel, round2 } from './pricing.service';

// The one pricing & settlement engine, shared by Food and Instamart orders.
// For an order (always a single seller) it works line by line:
//
//   order line → seller → seller's pricing model
//
//   COMMISSION: commission  = line amount × commissionPercent / 100
//               settlement  = line amount − commission
//               revenue     = commission
//   MARKUP:     markup      = platform price − seller's original price
//               settlement  = seller's original price
//               revenue     = markup
//
// then adds the order-level components — delivery, tax (pass-through), the
// coupon, the payment-gateway cost — and keeps every one of them as its own
// figure (they account and settle differently), ending in the platform's net
// profit. What differs between Food and Instamart (tax, delivery fee,
// item discounts, the commission %) is decided by the caller and passed in as
// plain numbers, so this stays one piece of logic.

export interface FinancialLineInput {
  // What the customer pays for the line, net of the item-level discount.
  customerAmount: number;
  // The same line at the seller's own (original) prices.
  vendorAmount: number;
}

export interface FinancialLine {
  commissionAmount: number;
  markupAmount: number;
  vendorSettlementAmount: number;
}

export interface Commission {
  type: string;
  value: number;
}

export interface OrderFinancialsInput {
  config: PricingConfig;
  // Ignored for a MARKUP seller. See resolveSellerCommission.
  commission: Commission | null;
  lines: FinancialLineInput[];
  deliveryFee: number;
  platformFee: number;
  couponDiscount: number;
  // What the customer is charged in all (the "final customer payable").
  orderTotal: number;
  paymentMethod: string;
}

export interface OrderFinancials {
  order: {
    pricingModel: string;
    commissionType?: string;
    commissionRate?: number;
    commissionBaseAmount?: number;
    commissionAmount?: number;
    customerPrice: number;
    vendorBaseAmount: number;
    markupAmount: number;
    vendorSettlementAmount: number;
    platformProfit: number;
    platformRevenue: number;
    deliveryRevenue: number;
    deliveryPartnerPayout: number;
    paymentGatewayFee: number;
    couponExpense: number;
    platformExpenses: number;
    platformNetProfit: number;
  };
  lines: FinancialLine[];
}

// The commission % lives on the seller's profile (never on a product). A
// seller with none set yet falls back to the older Commission rules, so
// existing sellers keep paying what they did until an admin sets their %.
export async function resolveSellerCommission(
  config: PricingConfig,
  scope: { locationId: string; vendorId?: string; storeId?: string; businessType: string },
): Promise<Commission | null> {
  if (isMarkupModel(config)) return null;
  if (typeof config.commissionPercent === 'number') return { type: DISCOUNT_TYPES.PERCENTAGE, value: config.commissionPercent };
  return commissionService.resolveCommission(scope);
}

export function paymentGatewayFeeFor(paymentMethod: string, orderTotal: number): number {
  if (paymentMethod !== PAYMENT_METHODS.RAZORPAY) return 0;
  return round2((orderTotal * env.PAYMENT_GATEWAY_FEE_PERCENT) / 100);
}

export function buildOrderFinancials(input: OrderFinancialsInput): OrderFinancials {
  const { config, lines: inputs } = input;
  const markup = isMarkupModel(config);
  const customerTotal = inputs.reduce((sum, l) => sum + l.customerAmount, 0);
  const commission = markup ? null : input.commission;

  // A flat (FIXED) commission can't be read per line, so it is shared out in
  // proportion to line amounts, the last line absorbing the rounding.
  let allocated = 0;
  const lines: FinancialLine[] = inputs.map((line, index) => {
    if (markup) {
      const vendorAmount = Math.min(line.vendorAmount, line.customerAmount);
      return {
        commissionAmount: 0,
        markupAmount: round2(line.customerAmount - vendorAmount),
        vendorSettlementAmount: round2(vendorAmount),
      };
    }
    let commissionAmount = 0;
    if (commission) {
      if (commission.type === DISCOUNT_TYPES.PERCENTAGE) {
        commissionAmount = round2((line.customerAmount * commission.value) / 100);
      } else if (index === inputs.length - 1) {
        commissionAmount = round2(commission.value - allocated);
      } else {
        commissionAmount = customerTotal > 0 ? round2((commission.value * line.customerAmount) / customerTotal) : 0;
      }
      allocated += commissionAmount;
    }
    return { commissionAmount, markupAmount: 0, vendorSettlementAmount: round2(line.customerAmount - commissionAmount) };
  });

  const sum = (pick: (l: FinancialLine) => number) => round2(lines.reduce((total, l) => total + pick(l), 0));
  const customerPrice = round2(customerTotal);
  const commissionAmount = sum((l) => l.commissionAmount);
  const markupAmount = sum((l) => l.markupAmount);
  const vendorSettlementAmount = sum((l) => l.vendorSettlementAmount);
  const platformRevenue = round2(commissionAmount + markupAmount);

  const deliveryRevenue = round2(input.deliveryFee);
  const deliveryPartnerPayout = round2(input.deliveryFee * (1 - env.PLATFORM_DELIVERY_MARGIN_PERCENT / 100));
  const paymentGatewayFee = paymentGatewayFeeFor(input.paymentMethod, input.orderTotal);
  // A coupon's value comes off what the customer pays but not off what the
  // seller is settled, so the platform absorbs it.
  const couponExpense = round2(input.couponDiscount);
  const platformExpenses = round2(deliveryPartnerPayout + paymentGatewayFee + couponExpense);
  const platformNetProfit = round2(platformRevenue + deliveryRevenue + input.platformFee - platformExpenses);

  return {
    lines,
    order: {
      pricingModel: markup ? PRICING_MODELS.MARKUP : PRICING_MODELS.COMMISSION,
      ...(commission
        ? {
            commissionType: commission.type,
            commissionRate: commission.value,
            commissionBaseAmount: customerPrice,
            commissionAmount,
          }
        : {}),
      customerPrice,
      vendorBaseAmount: markup ? round2(inputs.reduce((total, l) => total + Math.min(l.vendorAmount, l.customerAmount), 0)) : customerPrice,
      markupAmount,
      vendorSettlementAmount,
      // platformProfit is the original name for platformRevenue; kept so
      // clients written against it keep working.
      platformProfit: platformRevenue,
      platformRevenue,
      deliveryRevenue,
      deliveryPartnerPayout,
      paymentGatewayFee,
      couponExpense,
      platformExpenses,
      platformNetProfit,
    },
  };
}

// Worked example for the admin "what would this look like" preview: one line of
// `quantity` units at the seller's base `sellingPrice`. Under MARKUP the fixed
// amount is added to each customer unit price and the seller receives base.
export function previewFinancials(params: {
  sellingPrice: number;
  quantity: number;
  config: PricingConfig;
  markupAmount?: number;
  deliveryFee?: number;
  paymentMethod?: string;
}) {
  const { sellingPrice, quantity, config } = params;
  const markupAmount = effectiveMarkupAmount(config, { markupAmount: params.markupAmount });
  const customerAmount = round2(customerPriceOf(sellingPrice, markupAmount) * quantity);
  const vendorAmount = round2(sellingPrice * quantity);
  const deliveryFee = params.deliveryFee ?? 0;
  const paymentMethod = params.paymentMethod ?? PAYMENT_METHODS.COD;
  const commission =
    !isMarkupModel(config) && typeof config.commissionPercent === 'number'
      ? { type: DISCOUNT_TYPES.PERCENTAGE, value: config.commissionPercent }
      : null;

  const { order } = buildOrderFinancials({
    config,
    commission,
    lines: [{ customerAmount, vendorAmount }],
    deliveryFee,
    platformFee: 0,
    couponDiscount: 0,
    orderTotal: customerAmount + deliveryFee,
    paymentMethod,
  });
  return {
    sellingPrice,
    markupAmountPerUnit: markupAmount,
    quantity,
    ...order,
  };
}
