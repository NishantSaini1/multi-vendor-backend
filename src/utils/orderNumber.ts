import { ClientSession } from 'mongoose';
import { OrderSequence } from '../models/OrderSequence';

// Order number format: ANI-{STORE_CODE}-{SEQUENCE}
// e.g. ANI-SH001-0001, ANI-GR001-0042
// The sequence increments independently per store using an atomic $inc counter.
export async function generateOrderNumber(storeCode: string, session?: ClientSession): Promise<string> {
  const result = await OrderSequence.findOneAndUpdate(
    { storeCode },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session },
  );
  const seq = result.seq.toString().padStart(4, '0');
  return `ANI-${storeCode}-${seq}`;
}

// Allocates a unique store code for a new vendor/store from its name.
// Uses a separate counter row (prefixed with "__code__") so it never collides
// with order sequence rows.
export async function allocateStoreCode(name: string): Promise<string> {
  const prefix = name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || 'ST';
  const result = await OrderSequence.findOneAndUpdate(
    { storeCode: `__code__${prefix}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );
  return `${prefix}${result.seq.toString().padStart(3, '0')}`;
}
