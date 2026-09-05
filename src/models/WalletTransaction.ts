import { Schema, model, Document, Types } from 'mongoose';
import { WALLET_TRANSACTION_TYPES } from '../constants/paymentStatus';

export interface IWalletTransaction extends Document {
  _id: Types.ObjectId;
  walletId: Types.ObjectId;
  customerId: Types.ObjectId;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  reference?: string;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const walletTransactionSchema = new Schema<IWalletTransaction>(
  {
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    type: { type: String, enum: Object.values(WALLET_TRANSACTION_TYPES), required: true },
    amount: { type: Number, required: true },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reference: { type: String },
    note: { type: String },
  },
  { timestamps: true },
);

export const WalletTransaction = model<IWalletTransaction>('WalletTransaction', walletTransactionSchema);
