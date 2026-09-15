import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';

export interface IInstamartSubcategory extends Document {
  _id: Types.ObjectId;
  categoryId: Types.ObjectId;
  name: string;
  image?: string;
  sortOrder: number;
  status: string;
  // Set when a STORE (not an admin) added this subcategory — it stays shared
  // taxonomy (instantly usable by every store, same as an admin-created one),
  // but only the creating store may edit/delete it, and only while no other
  // store has a product listed under it yet (see instamartCategory.service.ts's
  // assertSubcategoryStoreWriteAccess) — so one store can never rename/remove
  // a subcategory another store already depends on.
  createdByStoreId?: Types.ObjectId;
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
    createdByStoreId: { type: Schema.Types.ObjectId, ref: 'Store' },
  },
  { timestamps: true },
);

export const InstamartSubcategory = model<IInstamartSubcategory>('InstamartSubcategory', instamartSubcategorySchema);
