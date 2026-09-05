import { Schema, model, Document, Types } from 'mongoose';
import { SETTLEMENT_STATUS } from '../constants/paymentStatus';

export const SETTLEMENT_PAYEE_TYPES = {
  VENDOR: 'VENDOR',
  STORE: 'STORE',
  DELIVERY_PARTNER: 'DELIVERY_PARTNER',
} as const;

export interface ISettlement extends Document {
  _id: Types.ObjectId;
  payeeType: string;
  payeeId: Types.ObjectId;
  locationId: Types.ObjectId;
  periodStart: Date;
  periodEnd: Date;
  grossAmount: number;
  commissionAmount: number;
  adjustments: number;
  netAmount: number;
  status: string;
  orderIds: Types.ObjectId[];
  paidAt?: Date;
  transactionReference?: string;
  createdAt: Date;
  updatedAt: Date;
}

const settlementSchema = new Schema<ISettlement>(
  {
    payeeType: { type: String, enum: Object.values(SETTLEMENT_PAYEE_TYPES), required: true, index: true },
    payeeId: { type: Schema.Types.ObjectId, required: true, index: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    grossAmount: { type: Number, required: true, default: 0 },
    commissionAmount: { type: Number, required: true, default: 0 },
    adjustments: { type: Number, default: 0 },
    netAmount: { type: Number, required: true, default: 0 },
    status: { type: String, enum: Object.values(SETTLEMENT_STATUS), default: SETTLEMENT_STATUS.PENDING },
    orderIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Order' }], default: [] },
    paidAt: { type: Date },
    transactionReference: { type: String },
  },
  { timestamps: true },
);

settlementSchema.index({ payeeType: 1, payeeId: 1, status: 1 });

export const Settlement = model<ISettlement>('Settlement', settlementSchema);
