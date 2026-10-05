import {
  applyMarkupPercent,
  customerModifierPrice,
  customerUnitPrice,
  derivePlatformFields,
  effectiveMarkupPercent,
  markupFoodItem,
  markupMartListing,
  platformPriceFor,
  redactPricingForViewer,
  PricingConfig,
} from '../../src/services/pricing.service';
import { buildOrderFinancials, previewFinancials } from '../../src/services/orderFinancials.service';

const commission = (percent?: number): PricingConfig => ({ pricingModel: 'COMMISSION', commissionPercent: percent });
const markup: PricingConfig = { pricingModel: 'MARKUP' };

describe('per-product markup', () => {
  it('COMMISSION sellers sell at their own price, whatever a product carries', () => {
    expect(platformPriceFor(100, commission(10), { markupPercent: 20 })).toBe(100);
    expect(derivePlatformFields(100, commission(10), { markupPercent: 20 })).toEqual({ platformSellingPrice: 100, markupAmount: 0 });
  });

  it('MARKUP: price + original × markup% / 100', () => {
    expect(platformPriceFor(100, markup, { markupPercent: 20 })).toBe(120);
    // ₹500 at 15% → markup ₹75, selling ₹575
    expect(derivePlatformFields(500, markup, { markupPercent: 15 })).toEqual({ platformSellingPrice: 575, markupAmount: 75 });
  });

  it('two products of the same MARKUP seller carry different markups', () => {
    expect(derivePlatformFields(100, markup, { markupPercent: 20 }).platformSellingPrice).toBe(120);
    expect(derivePlatformFields(200, markup, { markupPercent: 10 }).platformSellingPrice).toBe(220);
  });

  it('a MARKUP product with no markup % sells at its own price', () => {
    expect(platformPriceFor(100, markup, {})).toBe(100);
    expect(platformPriceFor(100, markup)).toBe(100);
    expect(effectiveMarkupPercent(markup, { markupPercent: 0 })).toBe(0);
  });

  it('variants and add-ons carry the same item markup', () => {
    expect(customerUnitPrice(50, markup, { markupPercent: 10 })).toBe(55);
    expect(customerModifierPrice(30, markup, { markupPercent: 20 })).toBe(36);
    expect(applyMarkupPercent(99.99, 10)).toBe(109.99);
  });
});

describe('order financials engine', () => {
  const base = { deliveryFee: 0, platformFee: 0, couponDiscount: 0, paymentMethod: 'COD' };

  describe('COMMISSION model (unchanged)', () => {
    it('commission = amount × percent / 100; vendor gets the rest; revenue = commission', () => {
      const { order, lines } = buildOrderFinancials({
        ...base,
        config: commission(15),
        commission: { type: 'PERCENTAGE', value: 15 },
        lines: [{ customerAmount: 200, vendorAmount: 200 }],
        orderTotal: 200,
      });
      expect(lines[0]).toEqual({ commissionAmount: 30, markupAmount: 0, vendorSettlementAmount: 170 });
      expect(order).toMatchObject({ pricingModel: 'COMMISSION', commissionRate: 15, commissionAmount: 30, markupAmount: 0, vendorSettlementAmount: 170, platformRevenue: 30 });
    });

    it('the spec example: 20% of ₹100 + ₹200 = ₹60', () => {
      const { order, lines } = buildOrderFinancials({
        ...base,
        config: commission(20),
        commission: { type: 'PERCENTAGE', value: 20 },
        lines: [
          { customerAmount: 100, vendorAmount: 100 },
          { customerAmount: 200, vendorAmount: 200 },
        ],
        orderTotal: 300,
      });
      expect(lines.map((l) => l.commissionAmount)).toEqual([20, 40]);
      expect(order.commissionAmount).toBe(60);
    });

    it('shares a legacy flat commission across lines without losing a paisa', () => {
      const { order } = buildOrderFinancials({
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
      expect(order.commissionAmount).toBe(10);
    });

    it('no commission configured: seller keeps 100%', () => {
      const { order } = buildOrderFinancials({ ...base, config: commission(), commission: null, lines: [{ customerAmount: 200, vendorAmount: 200 }], orderTotal: 200 });
      expect(order.vendorSettlementAmount).toBe(200);
      expect(order.platformRevenue).toBe(0);
    });
  });

  describe('MARKUP model', () => {
    it('₹100 at 20% × 3: vendor ₹300, customer ₹360, admin profit ₹60', () => {
      const { order, lines } = buildOrderFinancials({
        ...base,
        config: markup,
        commission: { type: 'PERCENTAGE', value: 99 }, // must be ignored
        lines: [{ customerAmount: 360, vendorAmount: 300 }],
        orderTotal: 360,
      });
      expect(lines[0]).toEqual({ commissionAmount: 0, markupAmount: 60, vendorSettlementAmount: 300 });
      expect(order).toMatchObject({ pricingModel: 'MARKUP', customerPrice: 360, vendorBaseAmount: 300, markupAmount: 60, vendorSettlementAmount: 300, platformRevenue: 60 });
      expect(order.commissionAmount).toBeUndefined();
    });

    it('lines with different markups are profit-summed per line', () => {
      const { order, lines } = buildOrderFinancials({
        ...base,
        config: markup,
        commission: null,
        lines: [
          { customerAmount: 120, vendorAmount: 100 }, // 20%
          { customerAmount: 220, vendorAmount: 200 }, // 10%
        ],
        orderTotal: 340,
      });
      expect(lines.map((l) => l.markupAmount)).toEqual([20, 20]);
      expect(order.markupAmount).toBe(40);
      expect(order.vendorSettlementAmount).toBe(300);
    });

    it('never produces a negative markup', () => {
      const { order } = buildOrderFinancials({ ...base, config: markup, commission: null, lines: [{ customerAmount: 90, vendorAmount: 100 }], orderTotal: 90 });
      expect(order.markupAmount).toBe(0);
      expect(order.vendorSettlementAmount).toBe(90);
    });
  });

  it('vendor settlement + platform revenue always equals what the customer paid for the items', () => {
    for (const config of [markup, commission(12.5)]) {
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
    const input = { config: commission(10), commission: { type: 'PERCENTAGE', value: 10 }, lines: [{ customerAmount: 500, vendorAmount: 500 }] };

    it('keeps delivery, gateway fee, coupon and expenses as separate figures', () => {
      const { order } = buildOrderFinancials({ ...input, deliveryFee: 40, platformFee: 0, couponDiscount: 50, orderTotal: 490, paymentMethod: 'RAZORPAY' });
      expect(order.platformRevenue).toBe(50);
      expect(order.deliveryRevenue).toBe(40);
      expect(order.deliveryPartnerPayout).toBe(32);
      expect(order.paymentGatewayFee).toBe(9.8);
      expect(order.couponExpense).toBe(50);
      expect(order.platformExpenses).toBe(91.8);
      expect(order.platformNetProfit).toBe(-1.8);
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
      expect(previewFinancials({ vendorPrice: 100, quantity: 1, config: markup, markupPercent: 20 })).toMatchObject({
        vendorOriginalPrice: 100,
        markupPercent: 20,
        platformSellingPrice: 120,
        markupPerUnit: 20,
        customerPrice: 120,
        vendorSettlementAmount: 100,
        platformRevenue: 20,
      });
    });

    it('MARKUP with no markup % has no profit', () => {
      expect(previewFinancials({ vendorPrice: 100, quantity: 1, config: markup })).toMatchObject({ platformSellingPrice: 100, markupAmount: 0 });
    });

    it('applies the commission percent under COMMISSION and ignores any markup', () => {
      expect(previewFinancials({ vendorPrice: 100, quantity: 3, config: commission(10), markupPercent: 50 })).toMatchObject({
        markupPercent: 0,
        customerPrice: 300,
        commissionAmount: 30,
        vendorSettlementAmount: 270,
      });
    });
  });
});

describe('customer listing transforms', () => {
  it("shows the product's own marked-up price and hides the markup fields", () => {
    expect(markupFoodItem({ price: 100, mrp: 110, markupPercent: 20, platformSellingPrice: 120, markupAmount: 20 }, markup)).toEqual({ price: 120, mrp: 120 });
    expect(markupFoodItem({ price: 200, markupPercent: 10 }, markup)).toEqual({ price: 220 });
  });

  it('keeps commission sellers at their own price, still hiding the fields', () => {
    expect(markupFoodItem({ price: 100, markupPercent: 20, platformSellingPrice: 100, markupAmount: 0 }, commission(10))).toEqual({ price: 100 });
  });

  it('marks up an instamart listing including the derived "from" prices', () => {
    expect(markupMartListing({ sellingPrice: 50, markupPercent: 10, variantPriceFrom: 40, variantIdFrom: 'v1', minPackPrice: 40, mrp: 60 }, markup)).toEqual({
      sellingPrice: 55,
      variantPriceFrom: 44,
      variantIdFrom: 'v1',
      minPackPrice: 44,
      mrp: 60,
    });
  });
});

describe('redactPricingForViewer', () => {
  const order = {
    total: 120,
    customerPrice: 120,
    markupAmount: 20,
    markupPercent: 20,
    commissionAmount: 0,
    vendorSettlementAmount: 100,
    totalAdminProfit: 20,
    platformRevenue: 20,
    platformNetProfit: 12,
    paymentGatewayFee: 2,
    pricingModel: 'MARKUP',
  };

  it('hides everything but what the customer paid from customers and delivery partners', () => {
    for (const viewer of ['CUSTOMER', 'DELIVERY_PARTNER']) {
      expect(redactPricingForViewer(order, viewer)).toEqual({ total: 120, customerPrice: 120 });
    }
    expect(redactPricingForViewer([{ price: 120, vendorPrice: 100, markupPercent: 20 }], 'CUSTOMER')).toEqual([{ price: 120 }]);
  });

  it("shows vendors/stores their own settlement but not the platform's revenue and costs", () => {
    for (const viewer of ['VENDOR', 'STORE']) {
      expect(redactPricingForViewer(order, viewer)).toEqual({
        total: 120,
        customerPrice: 120,
        markupAmount: 20,
        markupPercent: 20,
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
