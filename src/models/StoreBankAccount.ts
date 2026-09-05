import { Schema, model, Document, Types } from 'mongoose';

export interface IStoreBankAccount extends Document {
  _id: Types.ObjectId;
  storeId: Types.ObjectId;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  branchName?: string;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const storeBankAccountSchema = new Schema<IStoreBankAccount>(
  {
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, unique: true },
    accountHolderName: { type: String, required: true },
    accountNumber: { type: String, required: true },
    ifscCode: { type: String, required: true, uppercase: true },
    bankName: { type: String, required: true },
    branchName: { type: String },
    isVerified: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const StoreBankAccount = model<IStoreBankAccount>('StoreBankAccount', storeBankAccountSchema);
