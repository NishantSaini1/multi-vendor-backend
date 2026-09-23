import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';
import { slugify } from '../utils/slug';

// Two kinds of category share this collection:
// - GLOBAL (vendorId: null) — the admin-managed taxonomy every vendor's menu
//   can reference ("North Indian"); read-only for vendors. Which global
//   categories a specific vendor may use is controlled via VendorCatalogAccess.
// - VENDOR-OWNED (vendorId set) — a vendor's own private menu section, visible
//   only to that vendor (and customers/admins), managed by that vendor alone,
//   and implicitly usable by its owner without any catalog-access grant.
// Records created before vendor-owned categories existed have no vendorId at
// all, which Mongo's { vendorId: null } matches — so they stay global.
export interface IFoodCategory extends Document {
  _id: Types.ObjectId;
  vendorId?: Types.ObjectId | null;
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
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null, index: true },
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
