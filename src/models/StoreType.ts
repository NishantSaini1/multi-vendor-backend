import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';

// A store's specialization (Grocery, Veg & Fruits, Cosmetics, ...) — a flat,
// admin-managed taxonomy (like FoodCategory/InstamartCategory), referenced by
// Store.storeTypeId rather than hardcoded as a fixed enum.
export interface IStoreType extends Document {
  _id: Types.ObjectId;
  name: string;
  image?: string;
  sortOrder: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const storeTypeSchema = new Schema<IStoreType>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    image: { type: String },
    sortOrder: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

storeTypeSchema.index({ status: 1 });

export const StoreType = model<IStoreType>('StoreType', storeTypeSchema);
