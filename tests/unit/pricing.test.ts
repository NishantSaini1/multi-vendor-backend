import {
  applyProductPricing,
  effectiveMarkupPercent,
  markupProfitOf,
  pricingRequestFromInput,
  productForViewer,
  redactPricingForViewer,
  settlementForViewer,
  vendorShareOf,
  PricingConfig,
} from '../../src/services/pricing.service';
import { buildOrderFinancials, previewFinancials } from '../../src/services/orderFinancials.service';
import { JwtPayload } from '../../src/utils/jwt';

const commission = (percent?: number): PricingConfig => ({ pricingModel: 'COMMISSION', commissionPercent: percent });
const markup: PricingConfig = { pricingModel: 'MARKUP' };
const admin = { userId: 'a', userType: 'ADMIN', role: 'SUPER_ADMIN', locationIds: [] } as unknown as JwtPayload;
const seller = { userId: 's', userType: 'STORE', role: 'STORE', locationIds: [] } as unknown as JwtPayload;

type Priced = Record<string, number | undefined>;
const apply = (config: PricingConfig, user: JwtPayload, request: Parameters<typeof applyProductPricing>[4], mrp?: number, doc: Priced = {}) => {
  applyProductPricing(doc, 'sellingPrice', config, user, request, mrp);
  return doc;
};

describe('markup split', () => {
  it('vendor payable = selling price / (1 + markup%); the rest is the platform profit', () => {
    expect(vendorShareOf(30, 20)).toBe(25);
    expect(markupProfitOf(30, 20)).toBe(5);
    // Rice: ₹60 at 20% → vendor ₹50, profit ₹10 per unit
    expect(vendorShareOf(60, 20)).toBe(50);
    expect(markupProfitOf(60, 20)).toBe(10);
  });

  it('with no markup the vendor keeps the whole sale', () => {
    expect(vendorShareOf(30, 0)).toBe(30);
    expect(markupProfitOf(30, 0)).toBe(0);
  });

  it('markup only exists on a MARKUP seller, and only when set', () => {
    expect(effectiveMarkupPercent(markup, { markupPercent: 20 })).toBe(20);
    expect(effectiveMarkupPercent(markup, { markupPercent: 0 })).toBe(0);
    expect(effectiveMarkupPercent(markup)).toBe(0);
    expect(effectiveMarkupPercent(commission(10), { markupPercent: 20 })).toBe(0);
  });
});

describe('product pricing rules', () => {
  describe('selling price', () => {
    it('is required', () => {
      expect(() => apply(commission(20), seller, {})).toThrow(/Selling price is required/);
      expect(() => apply(markup, seller, {})).toThrow(/Selling price is required/);
    });

    it('is whatever the seller sets, under either model', () => {
      expect(apply(commission(20), seller, { sellingPrice: 30 }, 32).sellingPrice).toBe(30);
      expect(apply(markup, seller, { sellingPrice: 30 }, 32).sellingPrice).toBe(30);
    });

    it('keeps the stored price when only something else is updated', () => {
      expect(apply(commission(20), seller, {}, 32, { sellingPrice: 30 }).sellingPrice).toBe(30);
    });
  });

  describe('MRP', () => {
    it('selling price ≤ MRP is valid', () => {
      expect(apply(commission(20), seller, { sellingPrice: 32 }, 32).sellingPrice).toBe(32);
      expect(apply(markup, seller, { sellingPrice: 30 }, 32).sellingPrice).toBe(30);
    });

    it('selling price above MRP is refused', () => {
      expect(() => apply(commission(20), seller, { sellingPrice: 35 }, 32)).toThrow('Selling price cannot be greater than MRP.');
      expect(() => apply(markup, seller, { sellingPrice: 35 }, 32)).toThrow('Selling price cannot be greater than MRP.');
    });

    it('is re-checked when only the MRP changes', () => {
      expect(() => apply(commission(20), seller, {}, 28, { sellingPrice: 30 })).toThrow('Selling price cannot be greater than MRP.');
    });

    it('is not checked when there is no MRP', () => {
      expect(apply(commission(20), seller, { sellingPrice: 500 }).sellingPrice).toBe(500);
    });
  });

  describe('MARKUP — a per-product, admin-only markup', () => {
    it('₹30 at 20%: the platform profit is ₹5 per unit', () => {
      expect(apply(markup, admin, { sellingPrice: 30, markupPercent: 20 }, 32)).toMatchObject({ sellingPrice: 30, markupPercent: 20, markupAmount: 5 });
    });

    it('two products of the same seller carry different markups', () => {
      expect(apply(markup, admin, { sellingPrice: 30, markupPercent: 20 }).markupAmount).toBe(5);
      expect(apply(markup, admin, { sellingPrice: 60, markupPercent: 20 }).markupAmount).toBe(10);
      expect(apply(markup, admin, { sellingPrice: 45, markupPercent: 10 }).markupAmount).toBe(4.09);
    });

    it('a seller changing the price re-derives the markup amount, and cannot set the markup', () => {
      const doc = apply(markup, admin, { sellingPrice: 30, markupPercent: 20 });
      apply(markup, seller, { sellingPrice: 60 }, undefined, doc);
      expect(doc).toMatchObject({ sellingPrice: 60, markupPercent: 20, markupAmount: 10 });
      expect(() => apply(markup, seller, { sellingPrice: 30, markupPercent: 20 })).toThrow(/Only the platform/);
    });

    it('a markup can only be set on a MARKUP seller', () => {
      expect(() => apply(commission(20), admin, { sellingPrice: 30, markupPercent: 20 })).toThrow(/MARKUP pricing model/);
    });

    it('a MARKUP product with no markup yet has no profit', () => {
      expect(apply(markup, seller, { sellingPrice: 30 })).toMatchObject({ markupPercent: 0, markupAmount: 0 });
    });
  });

  describe('COMMISSION — nothing about markup is stored', () => {
    it('has no markup amount, and remembers a stored markup % without using it', () => {
      expect(apply(commission(20), seller, { sellingPrice: 30 }, undefined, { markupPercent: 15 })).toMatchObject({ markupPercent: 15, markupAmount: 0 });
    });
  });

  describe('request mapping', () => {
    it('takes the selling price from the price field the apps send, or platformSellingPrice', () => {
      expect(pricingRequestFromInput({ sellingPrice: 30 }, 'sellingPrice')).toEqual({ sellingPrice: 30, markupPercent: undefined });
      expect(pricingRequestFromInput({ price: 30 }, 'price').sellingPrice).toBe(30);
      expect(pricingRequestFromInput({ price: 20, platformSellingPrice: 30 }, 'price').sellingPrice).toBe(30);
    });

    it('drops a vendorOriginalPrice from an older app and removes the pricing keys from the body', () => {
      const body: Record<string, unknown> = { price: 30, vendorOriginalPrice: 25, markupPercent: 5, sku: 'x' };
      expect(pricingRequestFromInput(body, 'price')).toEqual({ sellingPrice: 30, markupPercent: 5 });
      expect(body).toEqual({ sku: 'x' });
    });
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

    it('20% of ₹100 + ₹200 = ₹60', () => {
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
    it('₹30 at 20% × 3: customer pays ₹90, vendor is settled ₹75, admin profit ₹15', () => {
      const customerAmount = 90;
      const { order, lines } = buildOrderFinancials({
        ...base,
        config: markup,
        commission: { type: 'PERCENTAGE', value: 99 }, // must be ignored
        lines: [{ customerAmount, vendorAmount: vendorShareOf(customerAmount, 20) }],
        orderTotal: 90,
      });
      expect(lines[0]).toEqual({ commissionAmount: 0, markupAmount: 15, vendorSettlementAmount: 75 });
      expect(order).toMatchObject({ pricingModel: 'MARKUP', customerPrice: 90, vendorBaseAmount: 75, markupAmount: 15, vendorSettlementAmount: 75, platformRevenue: 15 });
      expect(order.commissionAmount).toBeUndefined();
    });

    it('lines with different markups are profit-summed per line', () => {
      const { order, lines } = buildOrderFinancials({
        ...base,
        config: markup,
        commission: null,
        lines: [
          { customerAmount: 120, vendorAmount: vendorShareOf(120, 20) }, // 100 / 20
          { customerAmount: 220, vendorAmount: vendorShareOf(220, 10) }, // 200 / 20
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
          { customerAmount: 351.37, vendorAmount: vendorShareOf(351.37, 18) },
          { customerAmount: 99.99, vendorAmount: vendorShareOf(99.99, 5) },
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
    it('₹30 at 20% markup: the vendor gets ₹25, the platform ₹5', () => {
      expect(previewFinancials({ sellingPrice: 30, quantity: 1, config: markup, markupPercent: 20 })).toMatchObject({
        sellingPrice: 30,
        markupPercent: 20,
        markupPerUnit: 5,
        customerPrice: 30,
        vendorSettlementAmount: 25,
        platformRevenue: 5,
      });
    });

    it('MARKUP with no markup % has no profit', () => {
      expect(previewFinancials({ sellingPrice: 30, quantity: 1, config: markup })).toMatchObject({ markupAmount: 0, vendorSettlementAmount: 30 });
    });

    it('applies the commission percent under COMMISSION and ignores any markup', () => {
      expect(previewFinancials({ sellingPrice: 100, quantity: 3, config: commission(10), markupPercent: 50 })).toMatchObject({
        markupPercent: 0,
        customerPrice: 300,
        commissionAmount: 30,
        vendorSettlementAmount: 270,
      });
    });
  });
});

describe('who sees which product fields', () => {
  const product = { price: 30, mrp: 32, discount: 0, markupPercent: 20, markupAmount: 5, vendorOriginalPrice: 25, platformSellingPrice: 30, costPrice: 20 };

  it('admins see the markup', () => {
    expect(productForViewer(product, 'ADMIN')).toBe(product);
  });

  it('sellers see MRP, selling price and discount — never the markup', () => {
    for (const viewer of ['VENDOR', 'STORE']) {
      expect(productForViewer(product, viewer)).toEqual({ price: 30, mrp: 32, discount: 0, costPrice: 20 });
    }
  });

  it('customers also lose the seller cost price', () => {
    expect(productForViewer(product, 'CUSTOMER')).toEqual({ price: 30, mrp: 32, discount: 0 });
  });
});

describe('redactPricingForViewer', () => {
  const order = {
    total: 90,
    customerPrice: 90,
    price: 30,
    mrp: 32,
    discountPercent: 0,
    markupAmount: 15,
    markupPercent: 20,
    unitMarkupAmount: 5,
    vendorPrice: 25,
    commissionAmount: 0,
    vendorSettlementAmount: 75,
    vendorPayable: 75,
    totalVendorAmount: 75,
    totalAdminProfit: 15,
    adminProfit: 15,
    platformRevenue: 15,
    platformNetProfit: 12,
    paymentGatewayFee: 2,
    pricingModel: 'MARKUP',
  };

  it('hides everything but what the customer paid from customers and delivery partners', () => {
    for (const viewer of ['CUSTOMER', 'DELIVERY_PARTNER']) {
      expect(redactPricingForViewer(order, viewer)).toEqual({ total: 90, customerPrice: 90, price: 30, mrp: 32, discountPercent: 0 });
    }
  });

  it('shows sellers their payable and commission but never markup, admin profit or platform figures', () => {
    for (const viewer of ['VENDOR', 'STORE']) {
      expect(redactPricingForViewer(order, viewer)).toEqual({
        total: 90,
        customerPrice: 90,
        price: 30,
        mrp: 32,
        discountPercent: 0,
        commissionAmount: 0,
        vendorSettlementAmount: 75,
        vendorPayable: 75,
        pricingModel: 'MARKUP',
      });
    }
  });

  it('leaves admins with the full breakdown', () => {
    expect(redactPricingForViewer(order, 'ADMIN')).toBe(order);
  });
});

describe('settlementForViewer', () => {
  const settlement = { grossAmount: 100, commissionAmount: 10, markupAmount: 20, netAmount: 70 };

  it("hides the platform's markup deduction from sellers", () => {
    for (const viewer of ['VENDOR', 'STORE']) {
      expect(settlementForViewer(settlement, viewer)).toEqual({ grossAmount: 100, commissionAmount: 10, netAmount: 70 });
    }
  });

  it('leaves admins and delivery partners unchanged', () => {
    expect(settlementForViewer(settlement, 'ADMIN')).toBe(settlement);
    expect(settlementForViewer(settlement, 'DELIVERY_PARTNER')).toBe(settlement);
  });
});
