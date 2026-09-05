import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';

export interface IFoodProduct extends Document {
  _id: Types.ObjectId;
  locationId: Types.ObjectId;
  vendorId: Types.ObjectId;
  categoryId: Types.ObjectId;
  subcategoryId?: Types.ObjectId;
  name: string;
  description?: string;
  images: string[];
  price: number;
  discount: number;
  tax: number;
  isVeg: boolean;
  isAvailable: boolean;
  preparationTime: number;
  status: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const foodProductSchema = new Schema<IFoodProduct>(
  {
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'FoodCategory', required: true, index: true },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'FoodSubcategory' },
    name: { type: String, required: true, trim: true },
    description: { type: String },
    images: { type: [String], default: [] },
    price: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    isVeg: { type: Boolean, default: true },
    isAvailable: { type: Boolean, default: true },
    preparationTime: { type: Number, default: 20 },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

foodProductSchema.index({ vendorId: 1, status: 1 });
foodProductSchema.index({ locationId: 1, categoryId: 1 });
foodProductSchema.index({ name: 'text', description: 'text' });

export const FoodProduct = model<IFoodProduct>('FoodProduct', foodProductSchema);
