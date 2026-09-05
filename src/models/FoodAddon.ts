import { Schema, model, Document, Types } from 'mongoose';

export interface IFoodAddon extends Document {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  productIds: Types.ObjectId[];
  name: string;
  price: number;
  maxQuantity: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const foodAddonSchema = new Schema<IFoodAddon>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    productIds: { type: [{ type: Schema.Types.ObjectId, ref: 'FoodProduct' }], default: [] },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    maxQuantity: { type: Number, default: 1 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  },
  { timestamps: true },
);

export const FoodAddon = model<IFoodAddon>('FoodAddon', foodAddonSchema);
