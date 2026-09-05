import { Schema } from 'mongoose';

// Applied to every schema with a `password` field. `select: false` keeps it out of
// normal queries, but auth flows must explicitly `.select('+password')` to compare
// it — this transform guarantees it never survives serialization even then.
export function hidePasswordInJson(schema: Schema): void {
  schema.set('toJSON', {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.password;
      return ret;
    },
  });
  schema.set('toObject', {
    transform: (_doc, ret: Record<string, unknown>) => {
      delete ret.password;
      return ret;
    },
  });
}
