import { Schema, model, Document, Types } from 'mongoose';
import { DISCOUNT_TYPES, GENERIC_STATUS } from '../constants/enums';
import { BUSINESS_TYPES } from '../constants/orderStatus';

export interface IOffer extends Document {
  _id: Types.ObjectId;
  title: string;
  description?: string;
  discountType: string;
  discountValue: number;
  locationIds: Types.ObjectId[];
  businessType?: string;
  vendorIds: Types.ObjectId[];
  storeIds: Types.ObjectId[];
  startDate: Date;
  endDate: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const offerSchema = new Schema<IOffer>(
  {
    title: { type: String, required: true },
    description: { type: String },
    discountType: { type: String, enum: Object.values(DISCOUNT_TYPES), required: true },
    discountValue: { type: Number, required: true, min: 0 },
    locationIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Location' }], default: [] },
    businessType: { type: String, enum: Object.values(BUSINESS_TYPES) },
    vendorIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Vendor' }], default: [] },
    storeIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Store' }], default: [] },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

export const Offer = model<IOffer>('Offer', offerSchema);
