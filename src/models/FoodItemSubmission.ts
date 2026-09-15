import { Schema, model, Document, Types } from 'mongoose';
import { FOOD_TYPE, FOOD_ITEM_SUBMISSION_STATUS } from '../constants/enums';

// A vendor's "this item doesn't exist in the global catalog yet" proposal —
// reviewed by an admin (see foodItemSubmission.service.ts). Approval
// transactionally creates a FoodProduct (the new global item, tagged with
// submittedByVendorId) plus a VendorFoodItem for the submitting vendor using
// the proposed price/mrp/preparationTime, mirroring how InstamartProduct's
// "propose a new product" flow works but with an explicit admin-approval gate
// (Food items don't get the Instamart vertical's auto-approve treatment).
export interface IFoodItemSubmission extends Document {
  _id: Types.ObjectId;
  vendorId: Types.ObjectId;
  name: string;
  categoryId: Types.ObjectId;
  subcategoryId?: Types.ObjectId;
  description?: string;
  image?: string;
  foodType: string;
  price: number;
  mrp?: number;
  preparationTime?: number;
  status: string;
  rejectionReason?: string;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  resultingGlobalFoodItemId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const foodItemSubmissionSchema = new Schema<IFoodItemSubmission>(
  {
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    name: { type: String, required: true, trim: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'FoodCategory', required: true },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'FoodSubcategory' },
    description: { type: String },
    image: { type: String },
    foodType: { type: String, enum: Object.values(FOOD_TYPE), required: true, default: FOOD_TYPE.VEG },
    price: { type: Number, required: true, min: 0 },
    mrp: { type: Number, min: 0 },
    preparationTime: { type: Number, min: 0 },
    status: {
      type: String,
      enum: Object.values(FOOD_ITEM_SUBMISSION_STATUS),
      default: FOOD_ITEM_SUBMISSION_STATUS.PENDING_APPROVAL,
      index: true,
    },
    rejectionReason: { type: String },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    reviewedAt: { type: Date },
    resultingGlobalFoodItemId: { type: Schema.Types.ObjectId, ref: 'FoodProduct' },
  },
  { timestamps: true },
);

foodItemSubmissionSchema.index({ vendorId: 1, status: 1 });

export const FoodItemSubmission = model<IFoodItemSubmission>('FoodItemSubmission', foodItemSubmissionSchema);
