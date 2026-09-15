import { Schema, model, Document, Types } from 'mongoose';

// One active cart per customer (Food-only, single-vendor — see
// cart.service.ts). `vendorId` is null while the cart is empty; set on the
// first item added, cleared again once the cart empties (via removeItem/
// clearCart) so a customer can then start a fresh cart with a different
// vendor without needing to explicitly "switch."
export interface ICart extends Document {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  vendorId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const cartSchema = new Schema<ICart>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, unique: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null },
  },
  { timestamps: true },
);

export const Cart = model<ICart>('Cart', cartSchema);
