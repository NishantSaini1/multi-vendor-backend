import { Schema, model, Document, Types } from 'mongoose';
import { DELIVERY_PARTNER_STATUS, DELIVERY_PARTNER_AVAILABILITY } from '../constants/deliveryStatus';
import { hidePasswordInJson } from '../utils/schemaSecurity';

export interface IDeliveryPartner extends Document {
  _id: Types.ObjectId;
  locationId: Types.ObjectId;
  name: string;
  phone: string;
  email?: string;
  password: string;
  profileImage?: string;
  status: string;
  availability: string;
  currentLatitude?: number;
  currentLongitude?: number;
  currentLocationUpdatedAt?: Date;
  rating: number;
  ratingCount: number;
  currentOrderId?: Types.ObjectId;
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  totalEarnings: number;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryPartnerSchema = new Schema<IDeliveryPartner>(
  {
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true },
    email: { type: String, lowercase: true, trim: true, sparse: true, unique: true },
    password: { type: String, required: true, select: false },
    profileImage: { type: String },
    status: { type: String, enum: Object.values(DELIVERY_PARTNER_STATUS), default: DELIVERY_PARTNER_STATUS.PENDING },
    availability: {
      type: String,
      enum: Object.values(DELIVERY_PARTNER_AVAILABILITY),
      default: DELIVERY_PARTNER_AVAILABILITY.OFFLINE,
    },
    currentLatitude: { type: Number },
    currentLongitude: { type: Number },
    currentLocationUpdatedAt: { type: Date },
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    currentOrderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    totalOrders: { type: Number, default: 0 },
    completedOrders: { type: Number, default: 0 },
    cancelledOrders: { type: Number, default: 0 },
    totalEarnings: { type: Number, default: 0 },
  },
  { timestamps: true },
);

deliveryPartnerSchema.index({ locationId: 1, status: 1, availability: 1 });
hidePasswordInJson(deliveryPartnerSchema);

export const DeliveryPartner = model<IDeliveryPartner>('DeliveryPartner', deliveryPartnerSchema);
