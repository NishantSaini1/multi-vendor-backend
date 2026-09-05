import { Schema, model, Document, Types } from 'mongoose';

export interface IFoodVariant extends Document {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  name: string;
  price: number;
  isDefault: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const foodVariantSchema = new Schema<IFoodVariant>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'FoodProduct', required: true, index: true },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    isDefault: { type: Boolean, default: false },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  },
  { timestamps: true },
);

export const FoodVariant = model<IFoodVariant>('FoodVariant', foodVariantSchema);
