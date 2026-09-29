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
  acceptedAt?: Date;
  arrivedAtPickupAt?: Date;
  pickedUpAt?: Date;
  outForDeliveryAt?: Date;
  deliveredAt?: Date;
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
    acceptedAt: { type: Date },
    arrivedAtPickupAt: { type: Date },
    pickedUpAt: { type: Date },
    outForDeliveryAt: { type: Date },
    deliveredAt: { type: Date },
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
