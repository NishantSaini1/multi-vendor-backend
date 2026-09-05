import { Schema, model, Document, Types } from 'mongoose';

export interface IOrderItemAddon {
  addonId: Types.ObjectId;
  name: string;
  price: number;
  quantity: number;
}

export interface IOrderItem extends Document {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  productId: Types.ObjectId;
  variantId?: Types.ObjectId;
  name: string;
  price: number;
  quantity: number;
  addons: IOrderItemAddon[];
  itemTotal: number;
  createdAt: Date;
  updatedAt: Date;
}

const orderItemAddonSchema = new Schema<IOrderItemAddon>(
  {
    addonId: { type: Schema.Types.ObjectId, required: true },
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
    addons: { type: [orderItemAddonSchema], default: [] },
    itemTotal: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

export const OrderItem = model<IOrderItem>('OrderItem', orderItemSchema);
