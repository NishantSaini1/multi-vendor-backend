import { Schema, model, Document, Types } from 'mongoose';

export interface IPermission extends Document {
  _id: Types.ObjectId;
  key: string;
  description: string;
  module: string;
  createdAt: Date;
  updatedAt: Date;
}

const permissionSchema = new Schema<IPermission>(
  {
    key: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '' },
    module: { type: String, required: true, index: true },
  },
  { timestamps: true },
);

export const Permission = model<IPermission>('Permission', permissionSchema);
