import { Schema, model, Document, Types } from 'mongoose';
import { DELIVERY_ISSUE_TYPES, DELIVERY_ISSUE_STATUS } from '../constants/deliveryStatus';

export interface IDeliveryIssue extends Document {
  _id: Types.ObjectId;
  deliveryId: Types.ObjectId;
  orderId: Types.ObjectId;
  raisedBy: Types.ObjectId;
  raisedByType: string;
  type: string;
  description?: string;
  images: string[];
  status: string;
  resolutionNote?: string;
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryIssueSchema = new Schema<IDeliveryIssue>(
  {
    deliveryId: { type: Schema.Types.ObjectId, ref: 'Delivery', required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    raisedBy: { type: Schema.Types.ObjectId, required: true },
    raisedByType: { type: String, required: true },
    type: { type: String, enum: Object.values(DELIVERY_ISSUE_TYPES), required: true },
    description: { type: String },
    images: { type: [String], default: [] },
    status: { type: String, enum: Object.values(DELIVERY_ISSUE_STATUS), default: DELIVERY_ISSUE_STATUS.OPEN },
    resolutionNote: { type: String },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

export const DeliveryIssue = model<IDeliveryIssue>('DeliveryIssue', deliveryIssueSchema);
