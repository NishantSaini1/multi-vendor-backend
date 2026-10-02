import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS, VENDOR_FOOD_ITEM_AVAILABILITY } from '../constants/enums';

// A vendor's own listing of a GLOBAL Food Item (FoodProduct) — price, mrp,
// cost, prep time, and day-to-day availability all live here since they're
// vendor-specific; name/description/foodType/images stay on the shared
// FoodProduct. Mirrors InstamartProduct's role as the per-store mapping onto
// InstamartGlobalProduct. `status` is whether the vendor still lists this
// item at all; `availabilityStatus` is the day-to-day stock/86'd signal.
export interface IVendorFoodItem extends Document {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  globalFoodItemId: Types.ObjectId;
  // The vendor's own (original) price for this item.
  price: number;
  // MARKUP pricing model: what the platform lists this item at for customers,
  // and the difference from the seller's own price (markupAmount =
  // platformSellingPrice - the seller's original price). Kept in sync by
  // pricing.service; when platformPriceManual is true an admin has fixed the
  // platform price by hand, otherwise it follows the seller's default markup.
  // Unused (markup 0) for COMMISSION sellers.
  platformSellingPrice?: number;
  markupAmount: number;
  platformPriceManual: boolean;
  mrp?: number;
  costPrice?: number;
  availabilityStatus: string;
  preparationTime: number;
  vendorSku?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const vendorFoodItemSchema = new Schema<IVendorFoodItem>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    globalFoodItemId: { type: Schema.Types.ObjectId, ref: 'FoodProduct', required: true, index: true },
    price: { type: Number, required: true, min: 0 },
    platformSellingPrice: { type: Number, min: 0 },
    markupAmount: { type: Number, default: 0, min: 0 },
    platformPriceManual: { type: Boolean, default: false },
    mrp: { type: Number, min: 0 },
    costPrice: { type: Number, min: 0 },
    availabilityStatus: {
      type: String,
      enum: Object.values(VENDOR_FOOD_ITEM_AVAILABILITY),
      default: VENDOR_FOOD_ITEM_AVAILABILITY.AVAILABLE,
    },
    preparationTime: { type: Number, default: 20 },
    vendorSku: { type: String },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

// A vendor may only have one listing per global item.
vendorFoodItemSchema.index({ vendorId: 1, globalFoodItemId: 1 }, { unique: true });
vendorFoodItemSchema.index({ vendorId: 1, status: 1 });

export const VendorFoodItem = model<IVendorFoodItem>('VendorFoodItem', vendorFoodItemSchema);
