import { Schema, model, Document, Types } from 'mongoose';

// How the platform decides whether customers may order right now, given how
// many delivery partners are free (see deliveryCapacity.service.ts).
//   AUTO         — ordering is open only while at least `minAvailablePartners`
//                  partners are ACTIVE + ONLINE (not busy) within `radiusKm`
//                  of the seller. The default.
//   FORCE_OPEN   — always open, ignore partner availability (e.g. admins are
//                  assigning riders by hand).
//   FORCE_PAUSED — always paused, shown to customers as "high demand" (a manual
//                  kill switch).
// One document per location, plus at most one global document
// (locationId null) that applies to every location without its own.
export const DELIVERY_CAPACITY_MODES = {
  AUTO: 'AUTO',
  FORCE_OPEN: 'FORCE_OPEN',
  FORCE_PAUSED: 'FORCE_PAUSED',
} as const;

export interface IDeliveryCapacitySetting extends Document {
  _id: Types.ObjectId;
  locationId: Types.ObjectId | null;
  mode: string;
  minAvailablePartners: number;
  // Falls back to env.AUTO_ASSIGN_RADIUS_KM when unset, so "available" means
  // the same thing as "an auto-assigned order would find a rider".
  radiusKm?: number;
  // Shown to customers in place of the default high-demand message.
  message?: string;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryCapacitySettingSchema = new Schema<IDeliveryCapacitySetting>(
  {
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', default: null },
    mode: { type: String, enum: Object.values(DELIVERY_CAPACITY_MODES), default: DELIVERY_CAPACITY_MODES.AUTO },
    minAvailablePartners: { type: Number, default: 1, min: 1 },
    radiusKm: { type: Number, min: 0.5 },
    message: { type: String, trim: true, maxlength: 280 },
    updatedBy: { type: Schema.Types.ObjectId },
  },
  { timestamps: true },
);

deliveryCapacitySettingSchema.index({ locationId: 1 }, { unique: true });

export const DeliveryCapacitySetting = model<IDeliveryCapacitySetting>('DeliveryCapacitySetting', deliveryCapacitySettingSchema);
