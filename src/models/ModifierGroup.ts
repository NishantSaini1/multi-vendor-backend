import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';

// A named group of choices on a vendor's own listing (e.g. "Choose Sauce",
// "Add Extra Toppings") — replaces the old flat FoodAddon model with proper
// min/max/required semantics, same shape most food-delivery platforms use.
export interface IModifierGroup extends Document {
  _id: Types.ObjectId;
  vendorFoodItemId: Types.ObjectId;
  name: string;
  minSelection: number;
  maxSelection: number;
  required: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const modifierGroupSchema = new Schema<IModifierGroup>(
  {
    vendorFoodItemId: { type: Schema.Types.ObjectId, ref: 'VendorFoodItem', required: true, index: true },
    name: { type: String, required: true, trim: true },
    minSelection: { type: Number, default: 0, min: 0 },
    maxSelection: { type: Number, default: 1, min: 0 },
    required: { type: Boolean, default: false },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

export const ModifierGroup = model<IModifierGroup>('ModifierGroup', modifierGroupSchema);
