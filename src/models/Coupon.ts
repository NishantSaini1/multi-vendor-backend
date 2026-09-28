import { Schema, model, Document, Types } from 'mongoose';
import { DISCOUNT_TYPES, GENERIC_STATUS, PROMOTION_OWNER_TYPES } from '../constants/enums';
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
  // The GLOBAL Food Item (FoodProduct) ids this coupon is scoped to — empty
  // means unscoped/applies to any item, same convention as vendorIds/
  // storeIds/categoryIds above. Checked in coupon.service.ts's applyCoupon
  // against the order's line items' global food item ids.
  foodItemIds: Types.ObjectId[];
  // Admin-managed VendorType/StoreType ids — e.g. "every Pure Veg
  // restaurant" or "every Pharmacy store". Empty means unscoped, same
  // convention as vendorIds/storeIds. Matched against the ordering vendor's
  // vendorTypeIds / store's storeTypeIds (any overlap counts).
  vendorTypeIds: Types.ObjectId[];
  storeTypeIds: Types.ObjectId[];
  // PLATFORM (admin-created) or the VENDOR/STORE that created it itself — see
  // PROMOTION_OWNER_TYPES and utils/promotionOwnership.ts.
  ownerType: string;
  ownerId?: Types.ObjectId;
  firstOrderOnly: boolean;
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
    foodItemIds: { type: [{ type: Schema.Types.ObjectId, ref: 'FoodProduct' }], default: [] },
    vendorTypeIds: { type: [{ type: Schema.Types.ObjectId, ref: 'VendorType' }], default: [] },
    storeTypeIds: { type: [{ type: Schema.Types.ObjectId, ref: 'StoreType' }], default: [] },
    ownerType: { type: String, enum: Object.values(PROMOTION_OWNER_TYPES), default: PROMOTION_OWNER_TYPES.PLATFORM, index: true },
    ownerId: { type: Schema.Types.ObjectId, index: true },
    firstOrderOnly: { type: Boolean, default: false },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

export const Coupon = model<ICoupon>('Coupon', couponSchema);
