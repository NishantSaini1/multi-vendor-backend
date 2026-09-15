import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';

export interface IInstamartCategory extends Document {
  _id: Types.ObjectId;
  locationId?: Types.ObjectId;
  // Which store types this (top-level) category is relevant to — e.g. the
  // "Cosmetics" category only shows up for a Cosmetics-type store. Empty/absent
  // means universally visible to every store type (the default, and the only
  // state for a subcategory — visibility is decided at the parent category
  // level only). See store.service.ts / instamartCategory.service.ts.
  storeTypeIds?: Types.ObjectId[];
  name: string;
  image?: string;
  group?: string;
  sortOrder: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const instamartCategorySchema = new Schema<IInstamartCategory>(
  {
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null, index: true },
    storeTypeIds: { type: [{ type: Schema.Types.ObjectId, ref: 'StoreType' }], default: [] },
    name: { type: String, required: true, trim: true },
    image: { type: String },
    group: { type: String, trim: true },
    sortOrder: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

instamartCategorySchema.index({ locationId: 1, status: 1 });
instamartCategorySchema.index({ storeTypeIds: 1 });

export const InstamartCategory = model<IInstamartCategory>('InstamartCategory', instamartCategorySchema);
