import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS, APPROVAL_STATUS } from '../constants/enums';

// The centralized catalog entry — one canonical "Aashirvaad Atta 5kg" shared
// by every store that sells it (a marketplace of independent stores must not
// duplicate name/brand/images/MRP per store; only price/stock/sku differ per
// store — see InstamartProduct, which is now the per-store listing/mapping
// onto this document, not a product record itself).
export interface IInstamartGlobalProduct extends Document {
  _id: Types.ObjectId;
  name: string;
  brand?: string;
  categoryId: Types.ObjectId;
  subcategoryId?: Types.ObjectId;
  description?: string;
  unit: string;
  packSize?: string;
  weight?: number;
  images: string[];
  barcode?: string;
  hsn?: string;
  gst: number;
  mrp: number;
  // Both an admin-created product and a store's own "propose a new product"
  // are APPROVED immediately (no manual review gate) — see
  // instamartProduct.service.ts's createInstamartProduct. PENDING/REJECTED
  // are reachable only if an admin later flags a product that way; a store
  // may only map itself (Option A) onto an APPROVED product.
  approvalStatus: string;
  submittedByStoreId?: Types.ObjectId;
  rejectionReason?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const instamartGlobalProductSchema = new Schema<IInstamartGlobalProduct>(
  {
    name: { type: String, required: true, trim: true },
    brand: { type: String },
    categoryId: { type: Schema.Types.ObjectId, ref: 'InstamartCategory', required: true, index: true },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'InstamartSubcategory' },
    description: { type: String },
    unit: { type: String, required: true },
    packSize: { type: String },
    weight: { type: Number },
    images: { type: [String], default: [] },
    barcode: { type: String },
    hsn: { type: String },
    gst: { type: Number, default: 0 },
    mrp: { type: Number, required: true, min: 0 },
    approvalStatus: { type: String, enum: Object.values(APPROVAL_STATUS), default: APPROVAL_STATUS.APPROVED },
    submittedByStoreId: { type: Schema.Types.ObjectId, ref: 'Store' },
    rejectionReason: { type: String },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

instamartGlobalProductSchema.index({ categoryId: 1, subcategoryId: 1 });
instamartGlobalProductSchema.index({ approvalStatus: 1 });
instamartGlobalProductSchema.index({ name: 'text', brand: 'text' });
instamartGlobalProductSchema.index(
  { barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $exists: true, $type: 'string' } } },
);

export const InstamartGlobalProduct = model<IInstamartGlobalProduct>('InstamartGlobalProduct', instamartGlobalProductSchema);
