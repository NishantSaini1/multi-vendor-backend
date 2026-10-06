import { Schema, model, Document, Types } from 'mongoose';

// Admin-managed salary configuration for one delivery partner.
// There is at most one row per partner (unique on deliveryPartnerId).
// Admins can update it freely; each generated salary record snapshots the
// values that were active at generation time.
export interface IDeliveryPartnerSalaryConfig extends Document {
  _id: Types.ObjectId;
  deliveryPartnerId: Types.ObjectId;
  // Fixed monthly salary (₹).
  monthlySalary: number;
  // Whether this partner uses their own vehicle and should receive a per-km
  // vehicle allowance on top of the base salary.
  hasOwnVehicle: boolean;
  // ₹ per km — only applied when hasOwnVehicle is true.
  perKmRate: number;
  // Admin who last set/updated this config.
  updatedBy?: Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const deliveryPartnerSalaryConfigSchema = new Schema<IDeliveryPartnerSalaryConfig>(
  {
    deliveryPartnerId: { type: Schema.Types.ObjectId, ref: 'DeliveryPartner', required: true, unique: true, index: true },
    monthlySalary: { type: Number, required: true, min: 0 },
    hasOwnVehicle: { type: Boolean, default: false },
    perKmRate: { type: Number, default: 0, min: 0 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    notes: { type: String, trim: true },
  },
  { timestamps: true },
);

export const DeliveryPartnerSalaryConfig = model<IDeliveryPartnerSalaryConfig>(
  'DeliveryPartnerSalaryConfig',
  deliveryPartnerSalaryConfigSchema,
);
