import { Schema, model, Document, Types } from 'mongoose';

export interface IDeliveryPartnerVehicle extends Document {
  _id: Types.ObjectId;
  deliveryPartnerId: Types.ObjectId;
  type: string;
  make?: string;
  vehicleModel?: string;
  registrationNumber: string;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryPartnerVehicleSchema = new Schema<IDeliveryPartnerVehicle>(
  {
    deliveryPartnerId: { type: Schema.Types.ObjectId, ref: 'DeliveryPartner', required: true, unique: true },
    type: { type: String, enum: ['BICYCLE', 'BIKE', 'SCOOTER', 'CAR'], required: true },
    make: { type: String },
    vehicleModel: { type: String },
    registrationNumber: { type: String, required: true, uppercase: true },
    isVerified: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const DeliveryPartnerVehicle = model<IDeliveryPartnerVehicle>(
  'DeliveryPartnerVehicle',
  deliveryPartnerVehicleSchema,
);
