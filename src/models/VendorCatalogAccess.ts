import { Schema, model, Document, Types } from 'mongoose';

// Admin-controlled allow-list of which global Food categories/subcategories a
// vendor may use for its menu (see vendorCatalogAccess.service.ts). A null
// subcategoryId means the whole category is granted, not just one
// subcategory. There is no separate status field — the presence of a
// document IS the grant; deleting it revokes access.
export interface IVendorCatalogAccess extends Document {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  categoryId: Types.ObjectId;
  subcategoryId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const vendorCatalogAccessSchema = new Schema<IVendorCatalogAccess>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'FoodCategory', required: true, index: true },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'FoodSubcategory', default: null },
  },
  { timestamps: true },
);

// Prevents an exact duplicate grant (same vendor + category + subcategory,
// including two "whole category" grants where subcategoryId is null on both
// — Mongo's unique index treats a null value like any other for uniqueness
// purposes, so this still catches that case).
vendorCatalogAccessSchema.index({ vendorId: 1, categoryId: 1, subcategoryId: 1 }, { unique: true });

export const VendorCatalogAccess = model<IVendorCatalogAccess>('VendorCatalogAccess', vendorCatalogAccessSchema);
