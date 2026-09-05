import { Schema, model, Document, Types } from 'mongoose';
import { REVIEW_TARGET_TYPES, REVIEW_STATUS } from '../constants/enums';

export interface IReview extends Document {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  orderId: Types.ObjectId;
  targetType: string;
  targetId: Types.ObjectId;
  rating: number;
  comment?: string;
  images: string[];
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<IReview>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    targetType: { type: String, enum: Object.values(REVIEW_TARGET_TYPES), required: true },
    targetId: { type: Schema.Types.ObjectId, required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String },
    images: { type: [String], default: [] },
    status: { type: String, enum: Object.values(REVIEW_STATUS), default: REVIEW_STATUS.VISIBLE },
  },
  { timestamps: true },
);

reviewSchema.index({ targetType: 1, targetId: 1 });
reviewSchema.index({ orderId: 1, targetType: 1, targetId: 1 }, { unique: true });

export const Review = model<IReview>('Review', reviewSchema);
