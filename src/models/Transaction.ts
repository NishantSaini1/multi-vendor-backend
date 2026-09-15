import { Schema, model, Document, Types } from 'mongoose';
import { TRANSACTION_TYPE, TRANSACTION_DIRECTION, TRANSACTION_STATUS } from '../constants/enums';

// The general-purpose financial ledger — every money movement the platform
// ever records (a payment clearing, commission taken from a vendor/store, a
// delivery partner's earning, a refund paid out, a settlement disbursed).
// Settlement generation (settlement.service.ts) sources from THIS collection
// rather than re-querying Order and re-resolving commission live, so a
// historical settlement always reflects what was actually snapshotted/
// recorded at the time, not today's commission config. See
// ledger.service.ts's recordTransaction — the only way rows are created.
export interface ITransaction extends Document {
  _id: Types.ObjectId;
  orderId?: Types.ObjectId;
  vendorId?: Types.ObjectId;
  storeId?: Types.ObjectId;
  deliveryPartnerId?: Types.ObjectId;
  type: string;
  amount: number;
  direction: string;
  status: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    storeId: { type: Schema.Types.ObjectId, ref: 'Store' },
    deliveryPartnerId: { type: Schema.Types.ObjectId, ref: 'DeliveryPartner' },
    type: { type: String, enum: Object.values(TRANSACTION_TYPE), required: true },
    // Magnitude only — direction carries the sign/meaning (CREDIT: money
    // moving toward the payee/platform; DEBIT: money moving away from them).
    amount: { type: Number, required: true, min: 0 },
    direction: { type: String, enum: Object.values(TRANSACTION_DIRECTION), required: true },
    status: { type: String, enum: Object.values(TRANSACTION_STATUS), default: TRANSACTION_STATUS.COMPLETED },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

transactionSchema.index({ vendorId: 1, type: 1, createdAt: 1 });
transactionSchema.index({ storeId: 1, type: 1, createdAt: 1 });
transactionSchema.index({ deliveryPartnerId: 1, type: 1, createdAt: 1 });
transactionSchema.index({ orderId: 1 });

export const Transaction = model<ITransaction>('Transaction', transactionSchema);
