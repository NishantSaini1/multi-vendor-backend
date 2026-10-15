import { Schema, model, Document } from 'mongoose';

// Atomic per-store order sequence counter. Each storeCode gets its own row;
// findOneAndUpdate with $inc guarantees no two concurrent orders share a number.
//
// Rows whose storeCode starts with "__code__" are used by allocateStoreCode()
// to assign unique store codes to new vendors/stores — they don't represent order sequences.
export interface IOrderSequence extends Document {
  storeCode: string;
  seq: number;
}

const orderSequenceSchema = new Schema<IOrderSequence>({
  storeCode: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

export const OrderSequence = model<IOrderSequence>('OrderSequence', orderSequenceSchema);
