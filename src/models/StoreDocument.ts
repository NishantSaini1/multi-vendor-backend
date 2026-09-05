import { Schema, model, Document, Types } from 'mongoose';
import { APPROVAL_STATUS } from '../constants/enums';

export interface IStoreDocument extends Document {
  _id: Types.ObjectId;
  storeId: Types.ObjectId;
  type: string;
  fileUrl: string;
  status: string;
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

const storeDocumentSchema = new Schema<IStoreDocument>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    type: { type: String, required: true },
    fileUrl: { type: String, required: true },
    status: { type: String, enum: Object.values(APPROVAL_STATUS), default: APPROVAL_STATUS.PENDING },
    remarks: { type: String },
  },
  { timestamps: true },
);

export const StoreDocument = model<IStoreDocument>('StoreDocument', storeDocumentSchema);
