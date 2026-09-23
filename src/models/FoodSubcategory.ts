import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';
import { slugify } from '../utils/slug';

// Same GLOBAL (vendorId: null, admin-managed) vs VENDOR-OWNED (vendorId set)
// split as FoodCategory.ts. A vendor-owned subcategory may sit under a global
// category or under that same vendor's own category — never under another
// vendor's. A subcategory under a vendor-owned category is always owned by
// that vendor too (see foodSubcategory.service.ts).
export interface IFoodSubcategory extends Document {
  _id: Types.ObjectId;
  vendorId?: Types.ObjectId | null;
  categoryId: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  displayOrder: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const foodSubcategorySchema = new Schema<IFoodSubcategory>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'FoodCategory', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String },
    image: { type: String },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

// Auto-derive a kebab-case slug from name when the caller doesn't supply one.
// Runs on 'validate' (not 'save') so it happens before the `required` check.
foodSubcategorySchema.pre('validate', function (next) {
  if (!this.slug && this.name) {
    this.slug = slugify(this.name);
  }
  next();
});

export const FoodSubcategory = model<IFoodSubcategory>('FoodSubcategory', foodSubcategorySchema);
