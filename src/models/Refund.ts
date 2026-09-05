import { Schema, model, Document, Types } from 'mongoose';
import { REFUND_TYPES, REFUND_STATUS } from '../constants/paymentStatus';

export interface IRefund extends Document {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  paymentId: Types.ObjectId;
  customerId: Types.ObjectId;
  type: string;
  amount: number;
  reason: string;
  status: string;
  razorpayRefundId?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const refundSchema = new Schema<IRefund>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    type: { type: String, enum: Object.values(REFUND_TYPES), required: true },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, required: true },
    status: { type: String, enum: Object.values(REFUND_STATUS), default: REFUND_STATUS.PENDING },
    razorpayRefundId: { type: String },
    processedAt: { type: Date },
  },
  { timestamps: true },
);

export const Refund = model<IRefund>('Refund', refundSchema);
