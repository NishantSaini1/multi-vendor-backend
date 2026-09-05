import { Schema, model, Document, Types } from 'mongoose';
import { VENDOR_STATUS, APPROVAL_STATUS } from '../constants/enums';
import { hidePasswordInJson } from '../utils/schemaSecurity';

export interface IVendorTemporaryClosure {
  reopensAt?: Date;
  reason?: string;
}

export interface IVendor extends Document {
  _id: Types.ObjectId;
  locationId: Types.ObjectId;
  restaurantName: string;
  description?: string;
  logo?: string;
  coverImage?: string;
  ownerName: string;
  phone: string;
  email?: string;
  password: string;
  address: string;
  latitude: number;
  longitude: number;
  serviceRadius: number;
  cuisines: string[];
  gstNumber?: string;
  fssaiNumber?: string;
  panNumber?: string;
  rating: number;
  ratingCount: number;
  status: string;
  approvalStatus: string;
  isOpen: boolean;
  temporaryClosure?: IVendorTemporaryClosure | null;
  createdAt: Date;
  updatedAt: Date;
}

const vendorSchema = new Schema<IVendor>(
  {
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    restaurantName: { type: String, required: true, trim: true },
    description: { type: String },
    logo: { type: String },
    coverImage: { type: String },
    ownerName: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    email: { type: String, lowercase: true, trim: true, sparse: true, unique: true },
    password: { type: String, required: true, select: false },
    address: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    serviceRadius: { type: Number, default: 5 },
    cuisines: { type: [String], default: [] },
    gstNumber: { type: String },
    fssaiNumber: { type: String },
    panNumber: { type: String },
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(VENDOR_STATUS), default: VENDOR_STATUS.ACTIVE },
    approvalStatus: { type: String, enum: Object.values(APPROVAL_STATUS), default: APPROVAL_STATUS.PENDING },
    isOpen: { type: Boolean, default: false },
    temporaryClosure: {
      type: new Schema<IVendorTemporaryClosure>({ reopensAt: { type: Date }, reason: { type: String } }, { _id: false }),
      default: null,
    },
  },
  { timestamps: true },
);

vendorSchema.index({ locationId: 1, status: 1 });
vendorSchema.index({ latitude: 1, longitude: 1 });
vendorSchema.index({ restaurantName: 'text' });
hidePasswordInJson(vendorSchema);

export const Vendor = model<IVendor>('Vendor', vendorSchema);
