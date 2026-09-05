import { Schema, model, Document, Types } from 'mongoose';

export interface IDeliveryStatusHistory extends Document {
  _id: Types.ObjectId;
  deliveryId: Types.ObjectId;
  oldStatus?: string;
  newStatus: string;
  latitude?: number;
  longitude?: number;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryStatusHistorySchema = new Schema<IDeliveryStatusHistory>(
  {
    deliveryId: { type: Schema.Types.ObjectId, ref: 'Delivery', required: true, index: true },
    oldStatus: { type: String },
    newStatus: { type: String, required: true },
    latitude: { type: Number },
    longitude: { type: Number },
  },
  { timestamps: true },
);

export const DeliveryStatusHistory = model<IDeliveryStatusHistory>(
  'DeliveryStatusHistory',
  deliveryStatusHistorySchema,
);
