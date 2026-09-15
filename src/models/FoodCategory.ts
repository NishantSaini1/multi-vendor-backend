import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';
import { slugify } from '../utils/slug';

// Fully global, admin-managed taxonomy — mirrors InstamartCategory. A
// marketplace of independent vendors needs one canonical "North Indian"
// category every vendor's menu references, not each vendor inventing its own
// (see foodCategory.service.ts). Which categories/subcategories a specific
// vendor may actually use is controlled separately via VendorCatalogAccess.
export interface IFoodCategory extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  icon?: string;
  displayOrder: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const foodCategorySchema = new Schema<IFoodCategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String },
    image: { type: String },
    icon: { type: String },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

// Auto-derive a kebab-case slug from name when the caller doesn't supply one.
// Runs on 'validate' (not 'save') so it happens before the `required` check.
foodCategorySchema.pre('validate', function (next) {
  if (!this.slug && this.name) {
    this.slug = slugify(this.name);
  }
  next();
});

foodCategorySchema.index({ status: 1 });
foodCategorySchema.index({ name: 'text' });

export const FoodCategory = model<IFoodCategory>('FoodCategory', foodCategorySchema);
