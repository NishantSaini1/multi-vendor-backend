import { Schema, model, Document, Types } from 'mongoose';

// A selected modifier option snapshot (e.g. "Extra Cheese", +30) — replaces
// the old flat IOrderItemAddon now that Food uses ModifierGroup/ModifierOption
// instead of FoodAddon. Always empty for INSTAMART order items (addons/
// modifiers were never supported there — see order.service.ts).
export interface IOrderItemModifier {
  modifierGroupId: Types.ObjectId;
  modifierOptionId: Types.ObjectId;
  name: string;
  price: number;
  quantity: number;
}

// `productId` deliberately keeps its name across both business types even
// though what it points to differs: for FOOD it's a VendorFoodItem._id (the
// vendor's own listing — see order.service.ts's prepareFoodItems), for
// INSTAMART it's an InstamartProduct._id (the store's own listing). Both are
// "this vendor/store's own priced listing for the line," so the field's
// *meaning* — not its literal referenced collection — has stayed the same
// since before the Stage 2 FoodProduct/VendorFoodItem split.
export interface IOrderItem extends Document {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  productId: Types.ObjectId;
  variantId?: Types.ObjectId;
  name: string;
  // What the customer paid per unit. Under the MARKUP pricing model this is
  // the vendor's price plus the platform markup; vendorPrice is the vendor's
  // own original unit price (equal to `price` under COMMISSION, and absent on
  // orders placed before pricing models existed).
  price: number;
  vendorPrice?: number;
  // This line's share of the order's financials (line totals, all quantities):
  // commission withheld (COMMISSION sellers), markup baked into the price
  // (MARKUP sellers), and what the seller is settled for the line.
  commissionAmount?: number;
  markupAmount?: number;
  vendorSettlementAmount?: number;
  // Pricing snapshot at order time — never recomputed from the product's
  // current markup, so a later change can't rewrite history. vendorPrice is
  // the vendor's original unit price; platformSellingPrice what the customer
  // paid per unit; unitMarkupAmount the markup in each unit. The three totals
  // are line totals (all quantities, net of item discounts):
  // totalSellingAmount - totalVendorAmount = totalAdminProfit under MARKUP.
  markupPercent?: number;
  unitMarkupAmount?: number;
  platformSellingPrice?: number;
  totalVendorAmount?: number;
  totalSellingAmount?: number;
  totalAdminProfit?: number;
  // Also snapshotted: the vendor/store the line belongs to, the pricing model
  // it was sold under, the printed MRP and discount % at the time, and the
  // settlement outcome — commissionPercent/commissionAmount under COMMISSION
  // (the existing commission snapshot), totalAdminMarkupProfit under MARKUP;
  // vendorPayable is what the seller is owed for the line.
  vendorId?: Types.ObjectId;
  storeId?: Types.ObjectId;
  pricingModel?: string;
  vendorOriginalPrice?: number;
  mrp?: number;
  discountPercent?: number;
  commissionPercent?: number;
  vendorPayable?: number;
  totalAdminMarkupProfit?: number;
  quantity: number;
  modifiers: IOrderItemModifier[];
  itemTotal: number;
  createdAt: Date;
  updatedAt: Date;
}

const orderItemModifierSchema = new Schema<IOrderItemModifier>(
  {
    modifierGroupId: { type: Schema.Types.ObjectId, required: true },
    modifierOptionId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true, default: 1 },
  },
  { _id: false },
);

const orderItemSchema = new Schema<IOrderItem>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, required: true },
    variantId: { type: Schema.Types.ObjectId },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    vendorPrice: { type: Number, min: 0 },
    commissionAmount: { type: Number, min: 0 },
    markupAmount: { type: Number, min: 0 },
    vendorSettlementAmount: { type: Number },
    markupPercent: { type: Number, min: 0 },
    unitMarkupAmount: { type: Number, min: 0 },
    platformSellingPrice: { type: Number, min: 0 },
    totalVendorAmount: { type: Number, min: 0 },
    totalSellingAmount: { type: Number, min: 0 },
    totalAdminProfit: { type: Number },
    vendorId: { type: Schema.Types.ObjectId },
    storeId: { type: Schema.Types.ObjectId },
    pricingModel: { type: String },
    vendorOriginalPrice: { type: Number, min: 0 },
    mrp: { type: Number, min: 0 },
    discountPercent: { type: Number, min: 0 },
    commissionPercent: { type: Number, min: 0 },
    vendorPayable: { type: Number },
    totalAdminMarkupProfit: { type: Number, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    modifiers: { type: [orderItemModifierSchema], default: [] },
    itemTotal: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

export const OrderItem = model<IOrderItem>('OrderItem', orderItemSchema);
