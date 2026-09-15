import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';

// A vendor-specific size/portion option (e.g. "Half"/"Full") on top of a
// VendorFoodItem's own base price — repointed from the old FoodProduct (price
// was vendor-owned there too) to VendorFoodItem now that price lives there.
export interface IFoodVariant extends Document {
  _id: Types.ObjectId;
  vendorFoodItemId: Types.ObjectId;
  name: string;
  price: number;
  isDefault: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const foodVariantSchema = new Schema<IFoodVariant>(
  {
    vendorFoodItemId: { type: Schema.Types.ObjectId, ref: 'VendorFoodItem', required: true, index: true },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    isDefault: { type: Boolean, default: false },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

export const FoodVariant = model<IFoodVariant>('FoodVariant', foodVariantSchema);
