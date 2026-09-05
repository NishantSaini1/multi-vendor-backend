import { Schema, model, Document, Types } from 'mongoose';
import { COMMISSION_LEVELS, DISCOUNT_TYPES, GENERIC_STATUS } from '../constants/enums';
import { BUSINESS_TYPES } from '../constants/orderStatus';

export interface ICommission extends Document {
  _id: Types.ObjectId;
  level: string;
  locationId?: Types.ObjectId;
  vendorId?: Types.ObjectId;
  storeId?: Types.ObjectId;
  businessType?: string;
  type: string;
  value: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const commissionSchema = new Schema<ICommission>(
  {
    level: { type: String, enum: Object.values(COMMISSION_LEVELS), required: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location' },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    storeId: { type: Schema.Types.ObjectId, ref: 'Store' },
    businessType: { type: String, enum: Object.values(BUSINESS_TYPES) },
    type: { type: String, enum: Object.values(DISCOUNT_TYPES), required: true },
    value: { type: Number, required: true, min: 0 },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

commissionSchema.index({ level: 1, locationId: 1, vendorId: 1, storeId: 1 });

export const Commission = model<ICommission>('Commission', commissionSchema);
