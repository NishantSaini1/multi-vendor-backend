import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';

export interface IFoodCategory extends Document {
  _id: Types.ObjectId;
  locationId?: Types.ObjectId;
  vendorId?: Types.ObjectId;
  name: string;
  image?: string;
  sortOrder: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const foodCategorySchema = new Schema<IFoodCategory>(
  {
    // null locationId => global category available across all locations
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null, index: true },
    // set only for a vendor's own private category; null/absent => admin-managed
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null, index: true },
    name: { type: String, required: true, trim: true },
    image: { type: String },
    sortOrder: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

foodCategorySchema.index({ locationId: 1, status: 1 });
foodCategorySchema.index({ vendorId: 1, status: 1 });

export const FoodCategory = model<IFoodCategory>('FoodCategory', foodCategorySchema);
