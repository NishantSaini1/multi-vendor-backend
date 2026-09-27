import { Schema, model, Document, Types } from 'mongoose';

export const WALLET_TOPUP_STATUS = { PENDING: 'PENDING', PAID: 'PAID', FAILED: 'FAILED' } as const;

// One "Add money" attempt. The wallet is credited exactly once, when the
// gateway payment is verified (status PENDING → PAID); retries of the verify
// call on a PAID top-up are no-ops.
export interface IWalletTopup extends Document {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  amount: number;
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  status: string;
  failureReason?: string;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const walletTopupSchema = new Schema<IWalletTopup>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String },
    status: { type: String, enum: Object.values(WALLET_TOPUP_STATUS), default: WALLET_TOPUP_STATUS.PENDING, index: true },
    failureReason: { type: String },
    paidAt: { type: Date },
  },
  { timestamps: true },
);

export const WalletTopup = model<IWalletTopup>('WalletTopup', walletTopupSchema);
