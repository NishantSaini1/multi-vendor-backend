import { Schema, model, Document, Types } from 'mongoose';
import { DELIVERY_STATUS } from '../constants/deliveryStatus';

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
  },
  { timestamps: true },
);

deliverySchema.index({ deliveryPartnerId: 1, status: 1 });

export const Delivery = model<IDelivery>('Delivery', deliverySchema);
