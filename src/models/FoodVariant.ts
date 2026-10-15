import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS, QUANTITY_UNIT, VARIANT_TYPE, VENDOR_FOOD_ITEM_AVAILABILITY } from '../constants/enums';

// A vendor-specific size/portion option (e.g. "Half"/"Full") on top of a
// VendorFoodItem's own base price — repointed from the old FoodProduct (price
// was vendor-owned there too) to VendorFoodItem now that price lives there.
export interface IFoodVariant extends Document {
  _id: Types.ObjectId;
  vendorFoodItemId: Types.ObjectId;
  name: string;
  price: number;
  markupAmount: number;
  isDefault: boolean;
  // What this variant is, e.g. 250 GRAM / 6 PIECE (the name stays the label, e.g. "Half").
  variantType?: string;
  quantityValue?: number;
  quantityUnit?: string;
  mrp?: number;
  sku?: string;
  // Day-to-day availability of THIS variant (absent on older variants = available).
  availabilityStatus?: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const foodVariantSchema = new Schema<IFoodVariant>(
  {
    vendorFoodItemId: { type: Schema.Types.ObjectId, ref: 'VendorFoodItem', required: true, index: true },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    markupAmount: { type: Number, default: 0, min: 0 },
    isDefault: { type: Boolean, default: false },
    variantType: { type: String, enum: Object.values(VARIANT_TYPE) },
    quantityValue: { type: Number, min: 0 },
    quantityUnit: { type: String, enum: Object.values(QUANTITY_UNIT) },
    mrp: { type: Number, min: 0 },
    sku: { type: String, trim: true },
    availabilityStatus: {
      type: String,
      enum: [VENDOR_FOOD_ITEM_AVAILABILITY.AVAILABLE, VENDOR_FOOD_ITEM_AVAILABILITY.OUT_OF_STOCK],
      default: VENDOR_FOOD_ITEM_AVAILABILITY.AVAILABLE,
    },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

export const FoodVariant = model<IFoodVariant>('FoodVariant', foodVariantSchema);
