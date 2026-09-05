import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';

export interface IInstamartProduct extends Document {
  _id: Types.ObjectId;
  locationId: Types.ObjectId;
  storeId: Types.ObjectId;
  categoryId: Types.ObjectId;
  subcategoryId?: Types.ObjectId;
  name: string;
  brand?: string;
  sku: string;
  barcode?: string;
  mrp: number;
  sellingPrice: number;
  discount: number;
  tax: number;
  unit: string;
  packSize?: string;
  weight?: number;
  images: string[];
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const instamartProductSchema = new Schema<IInstamartProduct>(
  {
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'InstamartCategory', required: true, index: true },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'InstamartSubcategory' },
    name: { type: String, required: true, trim: true },
    brand: { type: String },
    sku: { type: String, required: true },
    barcode: { type: String },
    mrp: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    unit: { type: String, required: true },
    packSize: { type: String },
    weight: { type: Number },
    images: { type: [String], default: [] },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

instamartProductSchema.index({ storeId: 1, sku: 1 }, { unique: true });
instamartProductSchema.index({ locationId: 1, categoryId: 1 });
instamartProductSchema.index({ name: 'text', brand: 'text' });

export const InstamartProduct = model<IInstamartProduct>('InstamartProduct', instamartProductSchema);
