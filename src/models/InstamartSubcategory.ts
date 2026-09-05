import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';

export interface IInstamartSubcategory extends Document {
  _id: Types.ObjectId;
  categoryId: Types.ObjectId;
  name: string;
  image?: string;
  sortOrder: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const instamartSubcategorySchema = new Schema<IInstamartSubcategory>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: 'InstamartCategory', required: true, index: true },
    name: { type: String, required: true, trim: true },
    image: { type: String },
    sortOrder: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

export const InstamartSubcategory = model<IInstamartSubcategory>('InstamartSubcategory', instamartSubcategorySchema);
