import {
  applyMarkupPercent,
  applyProductPricing,
  customerModifierPrice,
  customerUnitPrice,
  effectiveMarkupPercent,
  markupFoodItem,
  markupMartListing,
  pricingRequestFromInput,
  redactPricingForViewer,
  resolveBasePricing,
  PricingConfig,
} from '../../src/services/pricing.service';
import { JwtPayload } from '../../src/utils/jwt';
import { buildOrderFinancials, previewFinancials } from '../../src/services/orderFinancials.service';

const commission = (percent?: number): PricingConfig => ({ pricingModel: 'COMMISSION', commissionPercent: percent });
const markup: PricingConfig = { pricingModel: 'MARKUP' };
const admin = { userId: 'a', userType: 'ADMIN', role: 'SUPER_ADMIN', locationIds: [] } as unknown as JwtPayload;
const seller = { userId: 's', userType: 'STORE', role: 'STORE', locationIds: [] } as unknown as JwtPayload;

type Priced = Record<string, number | undefined>;
const apply = (config: PricingConfig, user: JwtPayload, request: Parameters<typeof applyProductPricing>[4], mrp?: number, doc: Priced = {}) => {
  applyProductPricing(doc, 'sellingPrice', config, user, request, mrp);
  return doc;
};

describe('product pricing rules', () => {
  describe('MARKUP — derived from the vendor price and the product markup', () => {
    it('₹25 at 20%: markup ₹5, platform selling price ₹30 (MRP ₹32)', () => {
      expect(apply(markup, admin, { vendorOriginalPrice: 25, markupPercent: 20 }, 32)).toMatchObject({
        vendorOriginalPrice: 25,
        markupPercent: 20,
        markupAmount: 5,
        sellingPrice: 30,
        platformSellingPrice: 30,
      });
    });

    it('₹500 at 15% → markup ₹75, selling ₹575', () => {
      expect(apply(markup, admin, { vendorOriginalPrice: 500, markupPercent: 15 })).toMatchObject({ markupAmount: 75, sellingPrice: 575 });
    });

    it('two products of the same seller can carry different markups', () => {
      expect(apply(markup, admin, { vendorOriginalPrice: 100, markupPercent: 20 }).sellingPrice).toBe(120);
      expect(apply(markup, admin, { vendorOriginalPrice: 200, markupPercent: 10 }).sellingPrice).toBe(220);
    });

    it('a seller sets the vendor price; the markup it cannot set', () => {
      expect(apply(markup, seller, { vendorOriginalPrice: 25 }, undefined, { markupPercent: 20 })).toMatchObject({ sellingPrice: 30, markupAmount: 5 });
      expect(() => apply(markup, seller, { vendorOriginalPrice: 25, markupPercent: 20 })).toThrow(/Only the platform/);
    });

    it('changing the vendor price re-derives the selling price', () => {
      const doc = apply(markup, admin, { vendorOriginalPrice: 25, markupPercent: 20 });
      apply(markup, seller, { vendorOriginalPrice: 50 }, undefined, doc);
      expect(doc).toMatchObject({ vendorOriginalPrice: 50, sellingPrice: 60, markupAmount: 10 });
    });

    it('refuses a selling price that conflicts with the markup, accepts one that matches', () => {
      expect(() => apply(markup, admin, { vendorOriginalPrice: 25, markupPercent: 20, platformSellingPrice: 35 })).toThrow(/calculated/);
      expect(apply(markup, admin, { vendorOriginalPrice: 25, markupPercent: 20, platformSellingPrice: 30 }).sellingPrice).toBe(30);
    });

    it('needs a vendor original price', () => {
      expect(() => apply(markup, admin, { markupPercent: 20 })).toThrow(/Vendor original price/);
    });

    it('a markup can only be set on a MARKUP seller', () => {
      expect(() => apply(commission(20), admin, { sellingPrice: 30, markupPercent: 20 })).toThrow(/MARKUP pricing model/);
    });
  });

  describe('COMMISSION — selling price required, commission unchanged', () => {
    it('keeps the seller-set selling price next to the vendor original price', () => {
      expect(apply(commission(20), seller, { sellingPrice: 30, vendorOriginalPrice: 25 }, 32)).toMatchObject({
        sellingPrice: 30,
        platformSellingPrice: 30,
        vendorOriginalPrice: 25,
        markupAmount: 0,
      });
    });

    it('defaults the vendor original price to the selling price', () => {
      expect(apply(commission(20), seller, { sellingPrice: 30 }).vendorOriginalPrice).toBe(30);
    });

    it('requires a selling price', () => {
      expect(() => apply(commission(20), seller, { vendorOriginalPrice: 25 })).toThrow(/selling price is required/);
    });

    it('never touches the markup', () => {
      expect(apply(commission(20), seller, { sellingPrice: 30 }, undefined, { markupPercent: 15 }).markupAmount).toBe(0);
    });
  });

  describe('MRP', () => {
    it('selling price ≤ MRP is valid', () => {
      expect(apply(commission(20), seller, { sellingPrice: 32 }, 32).sellingPrice).toBe(32);
      expect(apply(commission(20), seller, { sellingPrice: 30 }, 32).sellingPrice).toBe(30);
    });

    it('selling price above MRP is refused', () => {
      expect(() => apply(commission(20), seller, { sellingPrice: 35 }, 32)).toThrow('Platform selling price cannot be greater than MRP.');
    });

    it('a markup that pushes the price over MRP is refused', () => {
      expect(() => apply(markup, admin, { vendorOriginalPrice: 25, markupPercent: 40 }, 32)).toThrow('Platform selling price cannot be greater than MRP.');
    });

    it('is not checked when there is no MRP', () => {
      expect(apply(markup, admin, { vendorOriginalPrice: 25, markupPercent: 40 }).sellingPrice).toBe(35);
    });
  });

  describe('legacy price field', () => {
    it('is the vendor price under MARKUP and the selling price under COMMISSION', () => {
      expect(pricingRequestFromInput(markup, { sellingPrice: 25 }, 'sellingPrice')).toMatchObject({ vendorOriginalPrice: 25 });
      expect(pricingRequestFromInput(commission(10), { sellingPrice: 30 }, 'sellingPrice')).toMatchObject({ sellingPrice: 30 });
    });

    it('removes the pricing keys from the body', () => {
      const body: Record<string, unknown> = { price: 30, markupPercent: 5, sku: 'x' };
      pricingRequestFromInput(commission(10), body, 'price');
      expect(body).toEqual({ sku: 'x' });
    });
  });

  describe('resolveBasePricing', () => {
    it('current data: the stored price is the selling price', () => {
      expect(resolveBasePricing(30, markup, { vendorOriginalPrice: 25, markupPercent: 20 })).toEqual({
        sellingPrice: 30,
        vendorOriginalPrice: 25,
        markupPercent: 20,
        markupAmount: 5,
      });
    });

    it('older MARKUP data (no vendorOriginalPrice): the stored price is the vendor price', () => {
      expect(resolveBasePricing(100, markup, { markupPercent: 20 })).toEqual({ sellingPrice: 120, vendorOriginalPrice: 100, markupPercent: 20, markupAmount: 20 });
    });

    it('COMMISSION: the stored price is what the customer pays, with no markup', () => {
      expect(resolveBasePricing(30, commission(20), { vendorOriginalPrice: 25, markupPercent: 15 })).toEqual({
        sellingPrice: 30,
        vendorOriginalPrice: 25,
        markupPercent: 0,
        markupAmount: 0,
      });
    });
  });

  it('variants and add-ons carry the item markup', () => {
    expect(customerUnitPrice(50, markup, { markupPercent: 10 })).toBe(55);
    expect(customerModifierPrice(30, markup, { markupPercent: 20 })).toBe(36);
    expect(customerUnitPrice(50, commission(10), { markupPercent: 10 })).toBe(50);
    expect(effectiveMarkupPercent(markup, { markupPercent: 0 })).toBe(0);
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
  it('shows the stored platform selling price and hides every vendor/markup field', () => {
    expect(
      markupFoodItem(
        { price: 30, mrp: 32, vendorOriginalPrice: 25, markupPercent: 20, platformSellingPrice: 30, markupAmount: 5, costPrice: 20 },
        markup,
      ),
    ).toEqual({ price: 30, mrp: 32 });
  });

  it('older MARKUP data still shows the derived selling price', () => {
    expect(markupFoodItem({ price: 200, markupPercent: 10 }, markup)).toEqual({ price: 220 });
  });

  it('COMMISSION sellers: the price they set, vendor price hidden', () => {
    expect(markupFoodItem({ price: 30, mrp: 32, vendorOriginalPrice: 25, markupAmount: 0, platformSellingPrice: 30 }, commission(10))).toEqual({ price: 30, mrp: 32 });
  });

  it('an instamart listing: base pack at its selling price, variants with the product markup', () => {
    expect(
      markupMartListing(
        { sellingPrice: 55, vendorOriginalPrice: 50, markupPercent: 10, variantPriceFrom: 40, variantIdFrom: 'v1', minPackPrice: 40, minVariantPrice: 40, mrp: 60 },
        markup,
      ),
    ).toEqual({ sellingPrice: 55, variantPriceFrom: 44, variantIdFrom: 'v1', minPackPrice: 44, mrp: 60 });
  });

  it('prices the base pack from its stored selling price in "from" fields', () => {
    expect(
      markupMartListing(
        { sellingPrice: 55, vendorOriginalPrice: 50, markupPercent: 10, variantPriceFrom: 55, variantIdFrom: null, minPackPrice: 55, minVariantPrice: null },
        markup,
      ),
    ).toEqual({ sellingPrice: 55, variantPriceFrom: 55, variantIdFrom: null, minPackPrice: 55 });
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
    vendorPayable: 100,
    vendorOriginalPrice: 100,
    totalAdminProfit: 20,
    totalAdminMarkupProfit: 20,
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

  it("shows vendors/stores their own settlement but not the platform's revenue, costs or markup profit", () => {
    for (const viewer of ['VENDOR', 'STORE']) {
      expect(redactPricingForViewer(order, viewer)).toEqual({
        total: 120,
        customerPrice: 120,
        markupPercent: 20,
        commissionAmount: 0,
        vendorSettlementAmount: 100,
        vendorPayable: 100,
        vendorOriginalPrice: 100,
        pricingModel: 'MARKUP',
      });
    }
  });

  it('leaves admins with the full breakdown', () => {
    expect(redactPricingForViewer(order, 'ADMIN')).toBe(order);
  });
});
