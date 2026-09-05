import { Schema, model, Document, Types } from 'mongoose';

export interface IWallet extends Document {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

const walletSchema = new Schema<IWallet>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, unique: true },
    balance: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

export const Wallet = model<IWallet>('Wallet', walletSchema);
