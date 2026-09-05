import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';

export interface IInstamartCategory extends Document {
  _id: Types.ObjectId;
  locationId?: Types.ObjectId;
  name: string;
  image?: string;
  sortOrder: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const instamartCategorySchema = new Schema<IInstamartCategory>(
  {
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null, index: true },
    name: { type: String, required: true, trim: true },
    image: { type: String },
    sortOrder: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

instamartCategorySchema.index({ locationId: 1, status: 1 });

export const InstamartCategory = model<IInstamartCategory>('InstamartCategory', instamartCategorySchema);
