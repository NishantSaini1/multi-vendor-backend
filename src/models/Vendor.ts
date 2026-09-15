import { Schema, model, Document, Types } from 'mongoose';
import { VENDOR_STATUS, APPROVAL_STATUS, DAYS_OF_WEEK } from '../constants/enums';
import { hidePasswordInJson } from '../utils/schemaSecurity';

export interface IVendorTemporaryClosure {
  reopensAt?: Date;
  reason?: string;
}

export interface IVendorBusinessHoursDay {
  day: string;
  openTime?: string;
  closeTime?: string;
  isClosed: boolean;
}

export interface IVendorBusinessHours {
  weeklySchedule: IVendorBusinessHoursDay[];
  holidays: Date[];
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
  // A vendor's specialization(s) (Multi-Cuisine, Pure Veg, Cloud Kitchen, ...)
  // — refs the admin-managed VendorType taxonomy (see models/VendorType.ts).
  // Replaces the earlier free-text `cuisines: string[]`.
  vendorTypeIds: Types.ObjectId[];
  gstNumber?: string;
  fssaiNumber?: string;
  panNumber?: string;
  rating: number;
  ratingCount: number;
  status: string;
  approvalStatus: string;
  isOpen: boolean;
  temporaryClosure?: IVendorTemporaryClosure | null;
  businessHours?: IVendorBusinessHours;
  createdAt: Date;
  updatedAt: Date;
}

const vendorBusinessHoursDaySchema = new Schema<IVendorBusinessHoursDay>(
  {
    day: { type: String, enum: Object.values(DAYS_OF_WEEK), required: true },
    openTime: { type: String },
    closeTime: { type: String },
    isClosed: { type: Boolean, default: false },
  },
  { _id: false },
);

const vendorBusinessHoursSchema = new Schema<IVendorBusinessHours>(
  {
    weeklySchedule: { type: [vendorBusinessHoursDaySchema], default: [] },
    holidays: { type: [Date], default: [] },
  },
  { _id: false },
);

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
    vendorTypeIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'VendorType' }],
      required: true,
      validate: {
        validator: (value: Types.ObjectId[]) => Array.isArray(value) && value.length > 0,
        message: 'At least one vendorTypeId is required',
      },
    },
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
    businessHours: { type: vendorBusinessHoursSchema },
  },
  { timestamps: true },
);

vendorSchema.index({ locationId: 1, status: 1 });
vendorSchema.index({ latitude: 1, longitude: 1 });
vendorSchema.index({ restaurantName: 'text' });
hidePasswordInJson(vendorSchema);

export const Vendor = model<IVendor>('Vendor', vendorSchema);
