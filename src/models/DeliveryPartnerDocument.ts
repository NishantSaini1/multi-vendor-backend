import { Schema, model, Document, Types } from 'mongoose';
import { APPROVAL_STATUS } from '../constants/enums';

export interface IDeliveryPartnerDocument extends Document {
  _id: Types.ObjectId;
  deliveryPartnerId: Types.ObjectId;
  type: string;
  fileUrl: string;
  status: string;
  remarks?: string;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryPartnerDocumentSchema = new Schema<IDeliveryPartnerDocument>(
  {
    deliveryPartnerId: { type: Schema.Types.ObjectId, ref: 'DeliveryPartner', required: true, index: true },
    type: { type: String, required: true },
    fileUrl: { type: String, required: true },
    status: { type: String, enum: Object.values(APPROVAL_STATUS), default: APPROVAL_STATUS.PENDING },
    remarks: { type: String },
  },
  { timestamps: true },
);

export const DeliveryPartnerDocument = model<IDeliveryPartnerDocument>(
  'DeliveryPartnerDocument',
  deliveryPartnerDocumentSchema,
);
