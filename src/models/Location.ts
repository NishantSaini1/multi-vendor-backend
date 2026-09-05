import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';

export interface ILocation extends Document {
  _id: Types.ObjectId;
  name: string;
  code: string;
  state: string;
  district: string;
  pincodes: string[];
  latitude: number;
  longitude: number;
  serviceRadius: number;
  timezone: string;
  currency: string;
  status: string;
  settings: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const locationSchema = new Schema<ILocation>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    state: { type: String, required: true },
    district: { type: String, required: true },
    pincodes: { type: [String], default: [] },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    serviceRadius: { type: Number, default: 10 },
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
    settings: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

locationSchema.index({ status: 1 });
locationSchema.index({ latitude: 1, longitude: 1 });

export const Location = model<ILocation>('Location', locationSchema);
