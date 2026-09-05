import { Schema, model, Document, Types } from 'mongoose';

export interface IRole extends Document {
  _id: Types.ObjectId;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<IRole>(
  {
    name: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '' },
    permissions: { type: [String], default: [] },
    isSystem: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Role = model<IRole>('Role', roleSchema);
