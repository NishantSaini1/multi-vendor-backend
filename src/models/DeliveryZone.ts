import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';

export interface IDeliveryZone extends Document {
  _id: Types.ObjectId;
  locationId: Types.ObjectId;
  name: string;
  polygon?: { type: 'Polygon'; coordinates: number[][][] };
  centerLatitude?: number;
  centerLongitude?: number;
  radius?: number;
  deliveryFee: number;
  freeDeliveryAbove: number;
  maxDistance: number;
  estimatedDeliveryTime: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryZoneSchema = new Schema<IDeliveryZone>(
  {
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    name: { type: String, required: true, trim: true },
    polygon: {
      type: { type: String, enum: ['Polygon'], default: undefined },
      coordinates: { type: [[[Number]]], default: undefined },
    },
    centerLatitude: { type: Number },
    centerLongitude: { type: Number },
    radius: { type: Number },
    deliveryFee: { type: Number, required: true, default: 0 },
    freeDeliveryAbove: { type: Number, default: 0 },
    maxDistance: { type: Number, default: 10 },
    estimatedDeliveryTime: { type: Number, default: 30 },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

deliveryZoneSchema.index({ locationId: 1, status: 1 });
deliveryZoneSchema.index({ polygon: '2dsphere' });

export const DeliveryZone = model<IDeliveryZone>('DeliveryZone', deliveryZoneSchema);
