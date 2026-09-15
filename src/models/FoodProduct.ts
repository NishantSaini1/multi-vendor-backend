import { Schema, model, Document, Types } from 'mongoose';
import { FOOD_TYPE, GLOBAL_FOOD_ITEM_STATUS } from '../constants/enums';
import { slugify } from '../utils/slug';

export interface IFoodNutritionInfo {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

// The GLOBAL Food Item — one canonical "Paneer Butter Masala" a marketplace of
// independent vendors all reference, mirroring how InstamartGlobalProduct
// works for the Instamart vertical. Price/availability/prep-time are no
// longer stored here — they're per-vendor now, on VendorFoodItem, since two
// vendors selling "Paneer Butter Masala" charge different prices. An item can
// arrive here either admin-created (submittedByVendorId unset, status ACTIVE
// immediately) or approved out of a vendor's FoodItemSubmission (see
// foodItemSubmission.service.ts).
export interface IFoodProduct extends Document {
  _id: Types.ObjectId;
  categoryId: Types.ObjectId;
  subcategoryId?: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  images: string[];
  foodType: string;
  ingredients?: string[];
  allergens?: string[];
  nutritionInfo?: IFoodNutritionInfo;
  status: string;
  submittedByVendorId?: Types.ObjectId;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const nutritionInfoSchema = new Schema<IFoodNutritionInfo>(
  {
    calories: { type: Number, min: 0 },
    protein: { type: Number, min: 0 },
    carbs: { type: Number, min: 0 },
    fat: { type: Number, min: 0 },
  },
  { _id: false },
);

const foodProductSchema = new Schema<IFoodProduct>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: 'FoodCategory', required: true, index: true },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'FoodSubcategory' },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String },
    images: { type: [String], default: [] },
    foodType: { type: String, enum: Object.values(FOOD_TYPE), required: true, default: FOOD_TYPE.VEG },
    ingredients: { type: [String], default: [] },
    allergens: { type: [String], default: [] },
    nutritionInfo: { type: nutritionInfoSchema },
    status: { type: String, enum: Object.values(GLOBAL_FOOD_ITEM_STATUS), default: GLOBAL_FOOD_ITEM_STATUS.ACTIVE },
    submittedByVendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null, index: true },
    displayOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// Auto-derive a kebab-case slug from name when the caller doesn't supply one.
// Runs on 'validate' (not 'save') so it happens before the `required` check.
foodProductSchema.pre('validate', function (next) {
  if (!this.slug && this.name) {
    this.slug = slugify(this.name);
  }
  next();
});

foodProductSchema.index({ categoryId: 1, subcategoryId: 1 });
foodProductSchema.index({ status: 1 });
foodProductSchema.index({ name: 'text', description: 'text' });

export const FoodProduct = model<IFoodProduct>('FoodProduct', foodProductSchema);
