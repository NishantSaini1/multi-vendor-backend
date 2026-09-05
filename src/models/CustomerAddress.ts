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
  },
  { timestamps: true },
);

export const CustomerAddress = model<ICustomerAddress>('CustomerAddress', customerAddressSchema);
