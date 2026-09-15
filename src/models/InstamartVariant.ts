import { Schema, model, Document, Types } from 'mongoose';

export interface IInstamartVariant extends Document {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  name: string;
  mrp: number;
  sellingPrice: number;
  isDefault: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const instamartVariantSchema = new Schema<IInstamartVariant>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'InstamartProduct', required: true, index: true },
    name: { type: String, required: true },
    mrp: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    isDefault: { type: Boolean, default: false },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
  },
  { timestamps: true },
);

export const InstamartVariant = model<IInstamartVariant>('InstamartVariant', instamartVariantSchema);
