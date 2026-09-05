import { Schema, model, Document, Types } from 'mongoose';

export interface IOrderStatusHistory extends Document {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  oldStatus?: string;
  newStatus: string;
  changedBy: Types.ObjectId;
  changedByType: string;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const orderStatusHistorySchema = new Schema<IOrderStatusHistory>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    oldStatus: { type: String },
    newStatus: { type: String, required: true },
    changedBy: { type: Schema.Types.ObjectId, required: true },
    changedByType: { type: String, required: true },
    reason: { type: String },
  },
  { timestamps: true },
);

orderStatusHistorySchema.index({ orderId: 1, createdAt: 1 });

export const OrderStatusHistory = model<IOrderStatusHistory>('OrderStatusHistory', orderStatusHistorySchema);
