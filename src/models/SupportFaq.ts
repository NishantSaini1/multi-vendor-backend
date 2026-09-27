import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';

// Admin-managed FAQ shown on the customer app's Help & Support screen.
// `category` optionally ties it to a SupportConfig category key so the app
// can show relevant answers before the customer opens a ticket.
export interface ISupportFaq extends Document {
  _id: Types.ObjectId;
  question: string;
  answer: string;
  category?: string;
  displayOrder: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const supportFaqSchema = new Schema<ISupportFaq>(
  {
    question: { type: String, required: true, maxlength: 300 },
    answer: { type: String, required: true, maxlength: 4000 },
    category: { type: String, index: true },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE, index: true },
  },
  { timestamps: true },
);

export const SupportFaq = model<ISupportFaq>('SupportFaq', supportFaqSchema);
