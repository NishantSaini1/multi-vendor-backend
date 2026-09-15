import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';

// A single store's listing of a shared InstamartGlobalProduct — name, brand,
// images, unit, MRP, etc. all live on the global product; this document only
// carries what genuinely differs store-to-store (price, discount, store's
// own SKU, availability). See instamartProduct.service.ts's withGlobalProduct
// enrichment, which flattens the joined global fields onto API responses.
export interface IInstamartProduct extends Document {
  _id: Types.ObjectId;
  locationId: Types.ObjectId;
  storeId: Types.ObjectId;
  productId: Types.ObjectId;
  categoryId: Types.ObjectId;
  subcategoryId?: Types.ObjectId;
  sku?: string;
  sellingPrice: number;
  discount: number;
  sortOrder: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const instamartProductSchema = new Schema<IInstamartProduct>(
  {
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'InstamartGlobalProduct', required: true, index: true },
    // Denormalized from the global product at mapping time (not independently
    // editable — see updateInstamartProduct) so category-scoped queries never
    // need a join.
    categoryId: { type: Schema.Types.ObjectId, ref: 'InstamartCategory', required: true, index: true },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'InstamartSubcategory' },
    sku: { type: String },
    sellingPrice: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0 },
    sortOrder: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

// A store lists a given global product at most once.
instamartProductSchema.index({ storeId: 1, productId: 1 }, { unique: true });
// partialFilterExpression (not sparse) — see InstamartProduct history: a
// sparse *compound* index only skips a document when ALL of its fields are
// missing, and storeId is always present, so `sparse: true` here still
// indexed every SKU-less product as {storeId, sku: null} and collided as
// soon as a store had a second one. The partial filter excludes SKU-less
// products from the index entirely.
instamartProductSchema.index(
  { storeId: 1, sku: 1 },
  { unique: true, partialFilterExpression: { sku: { $exists: true, $type: 'string' } } },
);
instamartProductSchema.index({ locationId: 1, categoryId: 1 });

export const InstamartProduct = model<IInstamartProduct>('InstamartProduct', instamartProductSchema);
