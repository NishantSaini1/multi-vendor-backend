import { Schema, model, Document, Types } from 'mongoose';
import { PAYMENT_METHODS, PAYMENT_STATUS } from '../constants/paymentStatus';

export interface IPayment extends Document {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  customerId: Types.ObjectId;
  amount: number;
  method: string;
  status: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  failureReason?: string;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: Object.values(PAYMENT_METHODS), required: true },
    status: { type: String, enum: Object.values(PAYMENT_STATUS), default: PAYMENT_STATUS.PENDING, index: true },
    razorpayOrderId: { type: String, index: true },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String, select: false },
    failureReason: { type: String },
    paidAt: { type: Date },
  },
  { timestamps: true },
);

export const Payment = model<IPayment>('Payment', paymentSchema);
