import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';
import { slugify } from '../utils/slug';

// A vendor's specialization (Multi-Cuisine, Pure Veg, Cloud Kitchen, Bakery &
// Desserts, ...) — a flat, admin-managed taxonomy (mirrors StoreType),
// referenced by Vendor.vendorTypeIds rather than hardcoded as a fixed enum.
export interface IVendorType extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  image?: string;
  icon?: string;
  displayOrder: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const vendorTypeSchema = new Schema<IVendorType>(
  {
    name: { type: String, required: true, trim: true, unique: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    image: { type: String },
    icon: { type: String },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

// Auto-derive a kebab-case slug from name when the caller doesn't supply one.
// Runs on 'validate' (not 'save') so it happens before the `required` check.
vendorTypeSchema.pre('validate', function (next) {
  if (!this.slug && this.name) {
    this.slug = slugify(this.name);
  }
  next();
});

vendorTypeSchema.index({ status: 1 });

export const VendorType = model<IVendorType>('VendorType', vendorTypeSchema);
