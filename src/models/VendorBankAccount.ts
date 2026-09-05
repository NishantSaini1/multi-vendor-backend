import { Schema, model, Document, Types } from 'mongoose';

export interface IVendorBankAccount extends Document {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  branchName?: string;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const vendorBankAccountSchema = new Schema<IVendorBankAccount>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, unique: true },
    accountHolderName: { type: String, required: true },
    accountNumber: { type: String, required: true },
    ifscCode: { type: String, required: true, uppercase: true },
    bankName: { type: String, required: true },
    branchName: { type: String },
    isVerified: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const VendorBankAccount = model<IVendorBankAccount>('VendorBankAccount', vendorBankAccountSchema);
