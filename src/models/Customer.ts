import { Schema, model, Document, Types } from 'mongoose';
import { CUSTOMER_STATUS } from '../constants/enums';

export interface ICustomer extends Document {
  _id: Types.ObjectId;
  name?: string;
  phone: string;
  email?: string;
  profileImage?: string;
  status: string;
  walletBalance: number;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<ICustomer>(
  {
    name: { type: String, trim: true },
    phone: { type: String, required: true, unique: true },
    email: { type: String, lowercase: true, trim: true, sparse: true, unique: true },
    profileImage: { type: String },
    status: { type: String, enum: Object.values(CUSTOMER_STATUS), default: CUSTOMER_STATUS.ACTIVE },
    walletBalance: { type: Number, default: 0, min: 0 },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

export const Customer = model<ICustomer>('Customer', customerSchema);
