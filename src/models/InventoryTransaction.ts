import { Schema, model, Document, Types } from 'mongoose';
import { INVENTORY_TRANSACTION_TYPES } from '../constants/enums';

export interface IInventoryTransaction extends Document {
  _id: Types.ObjectId;
  inventoryId: Types.ObjectId;
  storeId: Types.ObjectId;
  productId: Types.ObjectId;
  type: string;
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  reference?: string;
  referenceType?: string;
  performedBy?: Types.ObjectId;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const inventoryTransactionSchema = new Schema<IInventoryTransaction>(
  {
    inventoryId: { type: Schema.Types.ObjectId, ref: 'Inventory', required: true, index: true },
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'InstamartProduct', required: true, index: true },
    type: { type: String, enum: Object.values(INVENTORY_TRANSACTION_TYPES), required: true },
    quantity: { type: Number, required: true },
    stockBefore: { type: Number, required: true },
    stockAfter: { type: Number, required: true },
    reference: { type: String },
    referenceType: { type: String },
    performedBy: { type: Schema.Types.ObjectId },
    note: { type: String },
  },
  { timestamps: true },
);

export const InventoryTransaction = model<IInventoryTransaction>('InventoryTransaction', inventoryTransactionSchema);
