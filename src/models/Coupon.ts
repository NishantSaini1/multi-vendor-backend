import { Schema, model, Document, Types } from 'mongoose';
import { DISCOUNT_TYPES, GENERIC_STATUS } from '../constants/enums';
import { BUSINESS_TYPES } from '../constants/orderStatus';

export interface ICoupon extends Document {
  _id: Types.ObjectId;
  code: string;
  discountType: string;
  discountValue: number;
  minimumOrder: number;
  maximumDiscount?: number;
  usageLimit?: number;
  perUserLimit?: number;
  usedCount: number;
  locationIds: Types.ObjectId[];
  businessTypes: string[];
  vendorIds: Types.ObjectId[];
  storeIds: Types.ObjectId[];
  categoryIds: Types.ObjectId[];
  startDate: Date;
  endDate: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const couponSchema = new Schema<ICoupon>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    discountType: { type: String, enum: Object.values(DISCOUNT_TYPES), required: true },
    discountValue: { type: Number, required: true, min: 0 },
    minimumOrder: { type: Number, default: 0 },
    maximumDiscount: { type: Number },
    usageLimit: { type: Number },
    perUserLimit: { type: Number, default: 1 },
    usedCount: { type: Number, default: 0 },
    locationIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Location' }], default: [] },
    businessTypes: { type: [String], enum: Object.values(BUSINESS_TYPES), default: [] },
    vendorIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Vendor' }], default: [] },
    storeIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Store' }], default: [] },
    categoryIds: { type: [{ type: Schema.Types.ObjectId }], default: [] },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

export const Coupon = model<ICoupon>('Coupon', couponSchema);
