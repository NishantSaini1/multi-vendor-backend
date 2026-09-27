import { Schema, model, Document, Types } from 'mongoose';
import { ADDRESS_TYPES } from '../constants/enums';

export interface ICustomerAddress extends Document {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  locationId: Types.ObjectId;
  address: string;
  landmark?: string;
  pincode: string;
  latitude: number;
  longitude: number;
  type: string;
  isDefault: boolean;
  // Who receives the order at this address. Optional — older addresses have
  // neither, and callers fall back to the customer's own name/phone.
  contactName?: string;
  contactPhone?: string;
  createdAt: Date;
  updatedAt: Date;
}

const customerAddressSchema = new Schema<ICustomerAddress>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    address: { type: String, required: true },
    landmark: { type: String },
    pincode: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    type: { type: String, enum: Object.values(ADDRESS_TYPES), default: ADDRESS_TYPES.HOME },
    isDefault: { type: Boolean, default: false },
    contactName: { type: String, trim: true },
    contactPhone: { type: String, trim: true },
  },
  { timestamps: true },
);

export const CustomerAddress = model<ICustomerAddress>('CustomerAddress', customerAddressSchema);
