import { Schema, model, Document, Types } from 'mongoose';
import { GENERIC_STATUS } from '../constants/enums';

// One selectable choice within a ModifierGroup (e.g. "Extra Cheese" — +30).
export interface IModifierOption extends Document {
  _id: Types.ObjectId;
  modifierGroupId: Types.ObjectId;
  name: string;
  price: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const modifierOptionSchema = new Schema<IModifierOption>(
  {
    modifierGroupId: { type: Schema.Types.ObjectId, ref: 'ModifierGroup', required: true, index: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

export const ModifierOption = model<IModifierOption>('ModifierOption', modifierOptionSchema);
