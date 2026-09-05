import { Schema, model, Document, Types } from 'mongoose';
import { APPROVAL_STATUS } from '../constants/enums';

export interface IVendorDocument extends Document {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  type: string;
  fileUrl: string;
  status: string;
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

const vendorDocumentSchema = new Schema<IVendorDocument>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    type: { type: String, required: true },
    fileUrl: { type: String, required: true },
    status: { type: String, enum: Object.values(APPROVAL_STATUS), default: APPROVAL_STATUS.PENDING },
    remarks: { type: String },
  },
  { timestamps: true },
);

export const VendorDocument = model<IVendorDocument>('VendorDocument', vendorDocumentSchema);
