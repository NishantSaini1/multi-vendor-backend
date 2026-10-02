import {
  buildOrderPricingSnapshot,
  customerModifierPrice,
  customerUnitPrice,
  markupFoodItem,
  markupMartListing,
  previewPricing,
  redactPricingForViewer,
  PricingConfig,
} from '../../src/services/pricing.service';

const commission: PricingConfig = { pricingModel: 'COMMISSION', markupType: 'PERCENTAGE', markupValue: 0 };
const pctMarkup = (value: number): PricingConfig => ({ pricingModel: 'MARKUP', markupType: 'PERCENTAGE', markupValue: value });
const fixedMarkup = (value: number): PricingConfig => ({ pricingModel: 'MARKUP', markupType: 'FIXED', markupValue: value });

describe('pricing models', () => {
  describe('customerUnitPrice', () => {
    it('leaves the vendor price untouched under COMMISSION', () => {
      expect(customerUnitPrice(100, commission)).toBe(100);
    });

    it('adds a percentage markup', () => {
      expect(customerUnitPrice(100, pctMarkup(20))).toBe(120);
      expect(customerUnitPrice(99.99, pctMarkup(10))).toBe(109.99);
    });

    it('adds a flat markup per unit', () => {
      expect(customerUnitPrice(100, fixedMarkup(15))).toBe(115);
    });

    it('ignores a MARKUP model with no markup value', () => {
      expect(customerUnitPrice(100, pctMarkup(0))).toBe(100);
    });
  });

  it('only applies a percentage markup to modifier prices', () => {
    expect(customerModifierPrice(30, pctMarkup(20))).toBe(36);
    expect(customerModifierPrice(30, fixedMarkup(15))).toBe(30);
    expect(customerModifierPrice(30, commission)).toBe(30);
  });

  describe('buildOrderPricingSnapshot', () => {
    it('MARKUP: vendor ₹100 -> customer ₹120, vendor gets ₹100, platform profit ₹20', () => {
      const snapshot = buildOrderPricingSnapshot({ config: pctMarkup(20), customerAmount: 120, vendorAmount: 100 });
      expect(snapshot).toMatchObject({
        pricingModel: 'MARKUP',
        customerPrice: 120,
        vendorBaseAmount: 100,
        markupAmount: 20,
        vendorSettlementAmount: 100,
        platformProfit: 20,
      });
    });

    it('COMMISSION: vendor is settled the sale minus the commission, platform keeps the commission', () => {
      const snapshot = buildOrderPricingSnapshot({ config: commission, customerAmount: 200, vendorAmount: 200, commissionAmount: 30 });
      expect(snapshot).toMatchObject({
        pricingModel: 'COMMISSION',
        customerPrice: 200,
        vendorBaseAmount: 200,
        markupAmount: 0,
        vendorSettlementAmount: 170,
        platformProfit: 30,
      });
    });

    it('COMMISSION with no commission rule: vendor keeps 100%', () => {
      const snapshot = buildOrderPricingSnapshot({ config: commission, customerAmount: 200, vendorAmount: 200 });
      expect(snapshot.vendorSettlementAmount).toBe(200);
      expect(snapshot.platformProfit).toBe(0);
    });

    it('MARKUP never produces a negative markup', () => {
      const snapshot = buildOrderPricingSnapshot({ config: pctMarkup(20), customerAmount: 90, vendorAmount: 100 });
      expect(snapshot.markupAmount).toBe(0);
      expect(snapshot.vendorSettlementAmount).toBe(90);
    });

    it('settlement identity holds: vendor + platform = customer', () => {
      const markup = buildOrderPricingSnapshot({ config: pctMarkup(17.5), customerAmount: 352.5, vendorAmount: 300 });
      expect(markup.vendorSettlementAmount + markup.platformProfit).toBeCloseTo(markup.customerPrice, 2);
      const comm = buildOrderPricingSnapshot({ config: commission, customerAmount: 351.37, vendorAmount: 351.37, commissionAmount: 52.7055 });
      expect(comm.vendorSettlementAmount + comm.platformProfit).toBeCloseTo(comm.customerPrice, 2);
    });
  });

  describe('previewPricing', () => {
    it('shows the spec example under MARKUP', () => {
      expect(previewPricing({ vendorPrice: 100, quantity: 1, config: pctMarkup(20) })).toMatchObject({
        customerUnitPrice: 120,
        customerPrice: 120,
        vendorSettlementAmount: 100,
        markupAmount: 20,
        platformProfit: 20,
      });
    });

    it('scales with quantity and applies commission under COMMISSION', () => {
      expect(
        previewPricing({ vendorPrice: 100, quantity: 3, config: commission, commissionType: 'PERCENTAGE', commissionValue: 10 }),
      ).toMatchObject({ customerPrice: 300, platformProfit: 30, vendorSettlementAmount: 270 });
    });

    it('charges no commission under MARKUP even if a rate is supplied', () => {
      const result = previewPricing({ vendorPrice: 100, quantity: 1, config: pctMarkup(20), commissionType: 'PERCENTAGE', commissionValue: 10 });
      expect(result.platformProfit).toBe(20);
    });
  });

  describe('customer listing transforms', () => {
    it('marks up a food listing and keeps mrp from falling below the price', () => {
      expect(markupFoodItem({ price: 100, mrp: 110 }, pctMarkup(20))).toEqual({ price: 120, mrp: 120 });
      expect(markupFoodItem({ price: 100, mrp: 200 }, pctMarkup(20))).toEqual({ price: 120, mrp: 200 });
      expect(markupFoodItem({ price: 100 }, pctMarkup(20))).toEqual({ price: 120 });
    });

    it('returns the same object under COMMISSION', () => {
      const item = { price: 100 };
      expect(markupFoodItem(item, commission)).toBe(item);
    });

    it('marks up an instamart listing including the derived "from" prices', () => {
      expect(markupMartListing({ sellingPrice: 50, variantPriceFrom: 40, minPackPrice: 40, mrp: 60 }, pctMarkup(10))).toEqual({
        sellingPrice: 55,
        variantPriceFrom: 44,
        minPackPrice: 44,
        mrp: 60,
      });
    });
  });

  describe('redactPricingForViewer', () => {
    const order = { total: 120, customerPrice: 120, markupAmount: 20, platformProfit: 20, pricingModel: 'MARKUP', vendorBaseAmount: 100 };

    it('hides the vendor price and platform profit from customers and delivery partners', () => {
      for (const viewer of ['CUSTOMER', 'DELIVERY_PARTNER']) {
        expect(redactPricingForViewer(order, viewer)).toEqual({ total: 120, customerPrice: 120 });
      }
      expect(redactPricingForViewer([{ price: 120, vendorPrice: 100 }], 'CUSTOMER')).toEqual([{ price: 120 }]);
    });

    it('leaves admins, vendors and stores with the full breakdown', () => {
      for (const viewer of ['ADMIN', 'VENDOR', 'STORE']) {
        expect(redactPricingForViewer(order, viewer)).toBe(order);
      }
    });
  });
});
