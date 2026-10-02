import { Schema, model, Document, Types } from 'mongoose';
import { DELIVERY_STATUS, DELIVERY_ASSIGNMENT_MODE } from '../constants/deliveryStatus';

export interface IDeliveryPoint {
  address: string;
  latitude: number;
  longitude: number;
}

export interface IDelivery extends Document {
  _id: Types.ObjectId;
  orderId: Types.ObjectId;
  deliveryPartnerId: Types.ObjectId;
  pickupLocation: IDeliveryPoint;
  dropLocation: IDeliveryPoint;
  status: string;
  assignedAt?: Date;
  arrivedAtVendorAt?: Date;
  pickedUpAt?: Date;
  outForDeliveryAt?: Date;
  arrivedAtCustomerAt?: Date;
  deliveredAt?: Date;
  // Pickup proof: captured when partner verifies vendor OTP at the pickup point.
  pickupImageUrl?: string;
  pickupImagePublicId?: string;
  pickupLatitude?: number;
  pickupLongitude?: number;
  pickupTimestamp?: Date;
  // Delivery proof: captured when partner verifies customer OTP at drop point.
  deliveryImageUrl?: string;
  deliveryImagePublicId?: string;
  deliveryLatitude?: number;
  deliveryLongitude?: number;
  deliveryTimestamp?: Date;
  // OTP verification state — plaintext codes are stored for display in the
  // vendor/customer app (select:false); hashes are used for verification.
  vendorOtpCode?: string;
  vendorOtpHash?: string;
  vendorOtpVerified?: boolean;
  customerOtpCode?: string;
  customerOtpHash?: string;
  customerOtpVerified?: boolean;
  estimatedTime?: number;
  distance?: number;
  // Snapshotted at assignment time (assignDeliveryPartner) from the order's
  // own deliveryFee — see delivery.service.ts. partnerEarning is deliveryFee
  // net of the platform's delivery margin (env.PLATFORM_DELIVERY_MARGIN_PERCENT).
  deliveryFee?: number;
  partnerEarning?: number;
  // How the current partner got this delivery: AUTO (nearest-partner
  // auto-assignment) or MANUAL (an admin's assign/reassign).
  assignmentMode: string;
  // Partners who cancelled/declined (or let an auto-assignment time out) —
  // auto-assignment never offers this order to them again. An admin can
  // still assign one of them manually.
  declinedPartnerIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const deliveryPointSchema = new Schema<IDeliveryPoint>(
  {
    address: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  { _id: false },
);

const deliverySchema = new Schema<IDelivery>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
    deliveryPartnerId: { type: Schema.Types.ObjectId, ref: 'DeliveryPartner', required: true, index: true },
    pickupLocation: { type: deliveryPointSchema, required: true },
    dropLocation: { type: deliveryPointSchema, required: true },
    status: { type: String, enum: Object.values(DELIVERY_STATUS), default: DELIVERY_STATUS.ASSIGNED, index: true },
    assignedAt: { type: Date },
    arrivedAtVendorAt: { type: Date },
    pickedUpAt: { type: Date },
    outForDeliveryAt: { type: Date },
    arrivedAtCustomerAt: { type: Date },
    deliveredAt: { type: Date },
    pickupImageUrl: { type: String },
    pickupImagePublicId: { type: String },
    pickupLatitude: { type: Number },
    pickupLongitude: { type: Number },
    pickupTimestamp: { type: Date },
    deliveryImageUrl: { type: String },
    deliveryImagePublicId: { type: String },
    deliveryLatitude: { type: Number },
    deliveryLongitude: { type: Number },
    deliveryTimestamp: { type: Date },
    vendorOtpCode: { type: String, select: false },
    vendorOtpHash: { type: String, select: false },
    vendorOtpVerified: { type: Boolean, default: false },
    customerOtpCode: { type: String, select: false },
    customerOtpHash: { type: String, select: false },
    customerOtpVerified: { type: Boolean, default: false },
    estimatedTime: { type: Number },
    distance: { type: Number },
    deliveryFee: { type: Number, min: 0 },
    partnerEarning: { type: Number, min: 0 },
    assignmentMode: { type: String, enum: Object.values(DELIVERY_ASSIGNMENT_MODE), default: DELIVERY_ASSIGNMENT_MODE.MANUAL },
    declinedPartnerIds: { type: [{ type: Schema.Types.ObjectId, ref: 'DeliveryPartner' }], default: [] },
  },
  { timestamps: true },
);

deliverySchema.index({ deliveryPartnerId: 1, status: 1 });
// The auto-assignment sweep's "auto-assigned but not yet accepted" lookup.
deliverySchema.index({ status: 1, assignmentMode: 1, assignedAt: 1 });

export const Delivery = model<IDelivery>('Delivery', deliverySchema);
