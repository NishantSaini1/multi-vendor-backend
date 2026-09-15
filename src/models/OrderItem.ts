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
  price: number;
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
    quantity: { type: Number, required: true, min: 1 },
    modifiers: { type: [orderItemModifierSchema], default: [] },
    itemTotal: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

export const OrderItem = model<IOrderItem>('OrderItem', orderItemSchema);
