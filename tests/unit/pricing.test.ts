import {
  customerModifierPrice,
  customerUnitPrice,
  derivePlatformFields,
  markupFoodItem,
  markupMartListing,
  platformPriceFor,
  redactPricingForViewer,
  PricingConfig,
} from '../../src/services/pricing.service';
import { buildOrderFinancials, previewFinancials } from '../../src/services/orderFinancials.service';

const commission = (percent?: number): PricingConfig => ({
  pricingModel: 'COMMISSION',
  commissionPercent: percent,
  markupType: 'PERCENTAGE',
  markupValue: 0,
});
const pctMarkup = (value: number): PricingConfig => ({ pricingModel: 'MARKUP', markupType: 'PERCENTAGE', markupValue: value });
const fixedMarkup = (value: number): PricingConfig => ({ pricingModel: 'MARKUP', markupType: 'FIXED', markupValue: value });

describe('platform price math', () => {
  it('COMMISSION sellers sell at their own price', () => {
    expect(platformPriceFor(100, commission(10))).toBe(100);
    expect(derivePlatformFields(100, commission(10))).toEqual({ platformSellingPrice: 100, markupAmount: 0 });
  });

  it('MARKUP derives the platform price from the default markup', () => {
    expect(platformPriceFor(100, pctMarkup(20))).toBe(120);
    expect(platformPriceFor(100, fixedMarkup(15))).toBe(115);
    expect(derivePlatformFields(100, pctMarkup(20))).toEqual({ platformSellingPrice: 120, markupAmount: 20 });
  });

  it('MARKUP with no default markup leaves the price alone until an admin sets one', () => {
    expect(platformPriceFor(100, pctMarkup(0))).toBe(100);
  });

  it('an admin-fixed platform price wins, but never below the seller price', () => {
    const manual = { platformSellingPrice: 135, platformPriceManual: true };
    expect(platformPriceFor(100, pctMarkup(20), manual)).toBe(135);
    expect(derivePlatformFields(100, pctMarkup(20), manual)).toEqual({ platformSellingPrice: 135, markupAmount: 35 });
    expect(platformPriceFor(150, pctMarkup(20), manual)).toBe(150);
  });

  it('ignores a stale stored price that is not marked manual', () => {
    expect(platformPriceFor(100, pctMarkup(20), { platformSellingPrice: 999, platformPriceManual: false })).toBe(120);
  });

  it('ignores any platform price for a COMMISSION seller', () => {
    expect(platformPriceFor(100, commission(10), { platformSellingPrice: 135, platformPriceManual: true })).toBe(100);
  });

  it('variants use the default markup; flat markup is not added to add-ons', () => {
    expect(customerUnitPrice(50, pctMarkup(10))).toBe(55);
    expect(customerModifierPrice(30, pctMarkup(20))).toBe(36);
    expect(customerModifierPrice(30, fixedMarkup(15))).toBe(30);
  });
});

describe('order financials engine', () => {
  const base = { deliveryFee: 0, platformFee: 0, couponDiscount: 0, paymentMethod: 'COD' };

  describe('COMMISSION model', () => {
    it('commission = amount × percent / 100; vendor gets the rest; revenue = commission', () => {
      const { order, lines } = buildOrderFinancials({
        ...base,
        config: commission(15),
        commission: { type: 'PERCENTAGE', value: 15 },
        lines: [{ customerAmount: 200, vendorAmount: 200 }],
        orderTotal: 200,
      });
      expect(lines[0]).toEqual({ commissionAmount: 30, markupAmount: 0, vendorSettlementAmount: 170 });
      expect(order).toMatchObject({
        pricingModel: 'COMMISSION',
        commissionRate: 15,
        commissionAmount: 30,
        markupAmount: 0,
        vendorSettlementAmount: 170,
        platformRevenue: 30,
        platformProfit: 30,
        customerPrice: 200,
      });
    });

    it('applies the percentage to every line separately', () => {
      const { order, lines } = buildOrderFinancials({
        ...base,
        config: commission(10),
        commission: { type: 'PERCENTAGE', value: 10 },
        lines: [
          { customerAmount: 100, vendorAmount: 100 },
          { customerAmount: 250, vendorAmount: 250 },
        ],
        orderTotal: 350,
      });
      expect(lines.map((l) => l.commissionAmount)).toEqual([10, 25]);
      expect(order.commissionAmount).toBe(35);
      expect(order.vendorSettlementAmount).toBe(315);
    });

    it('shares a legacy flat commission across lines without losing a paisa', () => {
      const { order, lines } = buildOrderFinancials({
        ...base,
        config: commission(),
        commission: { type: 'FIXED', value: 10 },
        lines: [
          { customerAmount: 100, vendorAmount: 100 },
          { customerAmount: 100, vendorAmount: 100 },
          { customerAmount: 100, vendorAmount: 100 },
        ],
        orderTotal: 300,
      });
      expect(lines.reduce((s, l) => s + l.commissionAmount, 0)).toBeCloseTo(10, 2);
      expect(order.commissionAmount).toBe(10);
    });

    it('no commission configured: seller keeps 100%', () => {
      const { order } = buildOrderFinancials({
        ...base,
        config: commission(),
        commission: null,
        lines: [{ customerAmount: 200, vendorAmount: 200 }],
        orderTotal: 200,
      });
      expect(order.vendorSettlementAmount).toBe(200);
      expect(order.platformRevenue).toBe(0);
      expect(order.commissionAmount).toBeUndefined();
    });
  });

  describe('MARKUP model', () => {
    it('vendor ₹100 → customer ₹120: vendor gets ₹100, revenue = markup ₹20', () => {
      const { order, lines } = buildOrderFinancials({
        ...base,
        config: pctMarkup(20),
        commission: { type: 'PERCENTAGE', value: 99 }, // must be ignored
        lines: [{ customerAmount: 120, vendorAmount: 100 }],
        orderTotal: 120,
      });
      expect(lines[0]).toEqual({ commissionAmount: 0, markupAmount: 20, vendorSettlementAmount: 100 });
      expect(order).toMatchObject({
        pricingModel: 'MARKUP',
        customerPrice: 120,
        vendorBaseAmount: 100,
        markupAmount: 20,
        vendorSettlementAmount: 100,
        platformRevenue: 20,
      });
      expect(order.commissionAmount).toBeUndefined();
    });

    it('never produces a negative markup', () => {
      const { order } = buildOrderFinancials({
        ...base,
        config: pctMarkup(20),
        commission: null,
        lines: [{ customerAmount: 90, vendorAmount: 100 }],
        orderTotal: 90,
      });
      expect(order.markupAmount).toBe(0);
      expect(order.vendorSettlementAmount).toBe(90);
    });
  });

  it('vendor settlement + platform revenue always equals what the customer paid for the items', () => {
    for (const config of [pctMarkup(17.5), commission(12.5)]) {
      const { order } = buildOrderFinancials({
        ...base,
        config,
        commission: config.pricingModel === 'COMMISSION' ? { type: 'PERCENTAGE', value: 12.5 } : null,
        lines: [
          { customerAmount: 351.37, vendorAmount: 299 },
          { customerAmount: 99.99, vendorAmount: 85 },
        ],
        orderTotal: 451.36,
      });
      expect(order.vendorSettlementAmount + order.platformRevenue).toBeCloseTo(order.customerPrice, 2);
    }
  });

  describe('platform P&L components', () => {
    const input = {
      config: commission(10),
      commission: { type: 'PERCENTAGE', value: 10 },
      lines: [{ customerAmount: 500, vendorAmount: 500 }],
    };

    it('keeps delivery, gateway fee, coupon and expenses as separate figures', () => {
      const { order } = buildOrderFinancials({
        ...input,
        deliveryFee: 40,
        platformFee: 0,
        couponDiscount: 50,
        orderTotal: 490, // 500 + 40 delivery - 50 coupon (tax excluded here)
        paymentMethod: 'RAZORPAY',
      });
      expect(order.platformRevenue).toBe(50);
      expect(order.deliveryRevenue).toBe(40);
      expect(order.deliveryPartnerPayout).toBe(32); // 20% platform margin on delivery
      expect(order.paymentGatewayFee).toBe(9.8); // 2% of 490
      expect(order.couponExpense).toBe(50);
      expect(order.platformExpenses).toBe(91.8); // 32 + 9.8 + 50
      expect(order.platformNetProfit).toBe(-1.8); // 50 + 40 - 91.8
    });

    it('charges no gateway fee on COD or wallet orders', () => {
      for (const paymentMethod of ['COD', 'WALLET']) {
        const { order } = buildOrderFinancials({ ...input, deliveryFee: 0, platformFee: 0, couponDiscount: 0, orderTotal: 500, paymentMethod });
        expect(order.paymentGatewayFee).toBe(0);
        expect(order.platformNetProfit).toBe(50);
      }
    });
  });

  describe('previewFinancials', () => {
    it('shows the spec example under MARKUP', () => {
      expect(previewFinancials({ vendorPrice: 100, quantity: 1, config: pctMarkup(20) })).toMatchObject({
        vendorOriginalPrice: 100,
        platformSellingPrice: 120,
        markupPerUnit: 20,
        customerPrice: 120,
        vendorSettlementAmount: 100,
        platformRevenue: 20,
      });
    });

    it('uses an explicit platform price when given', () => {
      expect(previewFinancials({ vendorPrice: 100, quantity: 2, config: pctMarkup(20), platformPrice: 130 })).toMatchObject({
        platformSellingPrice: 130,
        customerPrice: 260,
        markupAmount: 60,
      });
    });

    it('applies the commission percent under COMMISSION', () => {
      expect(previewFinancials({ vendorPrice: 100, quantity: 3, config: commission(10) })).toMatchObject({
        customerPrice: 300,
        commissionAmount: 30,
        vendorSettlementAmount: 270,
        platformRevenue: 30,
      });
    });
  });
});

describe('customer listing transforms', () => {
  it('shows the platform price and hides the platform-pricing fields', () => {
    expect(markupFoodItem({ price: 100, mrp: 110, platformSellingPrice: 120, markupAmount: 20, platformPriceManual: false }, pctMarkup(20))).toEqual({
      price: 120,
      mrp: 120,
    });
  });

  it('uses an admin-fixed price in the listing', () => {
    expect(markupFoodItem({ price: 100, platformSellingPrice: 135, markupAmount: 35, platformPriceManual: true }, pctMarkup(20))).toEqual({ price: 135 });
  });

  it('keeps commission sellers at their own price, still hiding the fields', () => {
    expect(markupFoodItem({ price: 100, platformSellingPrice: 100, markupAmount: 0, platformPriceManual: false }, commission(10))).toEqual({ price: 100 });
  });

  it('marks up an instamart listing including the derived "from" prices', () => {
    expect(
      markupMartListing({ sellingPrice: 50, variantPriceFrom: 40, variantIdFrom: 'v1', minPackPrice: 40, mrp: 60 }, pctMarkup(10)),
    ).toEqual({ sellingPrice: 55, variantPriceFrom: 44, variantIdFrom: 'v1', minPackPrice: 44, mrp: 60 });
  });

  it('prices the base pack from its platform price in "from" fields', () => {
    expect(
      markupMartListing(
        { sellingPrice: 50, platformSellingPrice: 70, platformPriceManual: true, markupAmount: 20, variantPriceFrom: 50, variantIdFrom: null, minPackPrice: 50 },
        pctMarkup(10),
      ),
    ).toEqual({ sellingPrice: 70, variantPriceFrom: 70, variantIdFrom: null, minPackPrice: 70 });
  });
});

describe('redactPricingForViewer', () => {
  const order = {
    total: 120,
    customerPrice: 120,
    markupAmount: 20,
    commissionAmount: 0,
    vendorSettlementAmount: 100,
    platformRevenue: 20,
    platformNetProfit: 12,
    paymentGatewayFee: 2,
    pricingModel: 'MARKUP',
  };

  it('hides everything but what the customer paid from customers and delivery partners', () => {
    for (const viewer of ['CUSTOMER', 'DELIVERY_PARTNER']) {
      expect(redactPricingForViewer(order, viewer)).toEqual({ total: 120, customerPrice: 120 });
    }
    expect(redactPricingForViewer([{ price: 120, vendorPrice: 100 }], 'CUSTOMER')).toEqual([{ price: 120 }]);
  });

  it("shows vendors/stores their own settlement but not the platform's revenue and costs", () => {
    for (const viewer of ['VENDOR', 'STORE']) {
      expect(redactPricingForViewer(order, viewer)).toEqual({
        total: 120,
        customerPrice: 120,
        markupAmount: 20,
        commissionAmount: 0,
        vendorSettlementAmount: 100,
        pricingModel: 'MARKUP',
      });
    }
  });

  it('leaves admins with the full breakdown', () => {
    expect(redactPricingForViewer(order, 'ADMIN')).toBe(order);
  });
});
