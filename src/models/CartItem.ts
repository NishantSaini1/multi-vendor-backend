import { Schema, model, Document, Types } from 'mongoose';

// One line in a customer's Cart. `basePrice`/`modifierAmount`/`itemTotal` are
// snapshots recomputed from the DB on every mutation (add/update/read) — see
// cart.service.ts — never trusted from the client, same discipline
// order.service.ts uses at checkout.
export interface ICartItem extends Document {
  _id: Types.ObjectId;
  cartId: Types.ObjectId;
  vendorFoodItemId: Types.ObjectId;
  variantId?: Types.ObjectId;
  quantity: number;
  selectedModifierOptionIds: Types.ObjectId[];
  basePrice: number;
  modifierAmount: number;
  itemTotal: number;
  createdAt: Date;
  updatedAt: Date;
}

const cartItemSchema = new Schema<ICartItem>(
  {
    cartId: { type: Schema.Types.ObjectId, ref: 'Cart', required: true, index: true },
    vendorFoodItemId: { type: Schema.Types.ObjectId, ref: 'VendorFoodItem', required: true },
    variantId: { type: Schema.Types.ObjectId, ref: 'FoodVariant' },
    quantity: { type: Number, required: true, min: 1 },
    selectedModifierOptionIds: { type: [{ type: Schema.Types.ObjectId, ref: 'ModifierOption' }], default: [] },
    basePrice: { type: Number, required: true, min: 0 },
    modifierAmount: { type: Number, required: true, min: 0, default: 0 },
    itemTotal: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

export const CartItem = model<ICartItem>('CartItem', cartItemSchema);
