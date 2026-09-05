import { Schema, model, Document, Types } from 'mongoose';
import { UserType } from '../constants/roles';

export interface IRefreshToken extends Document {
  _id: Types.ObjectId;
  tokenId: string;
  userId: Types.ObjectId;
  userType: UserType;
  deviceId?: string;
  deviceType?: string;
  ip?: string;
  userAgent?: string;
  revoked: boolean;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    tokenId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    userType: { type: String, required: true },
    deviceId: { type: String },
    deviceType: { type: String },
    ip: { type: String },
    userAgent: { type: String },
    revoked: { type: Boolean, default: false },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

refreshTokenSchema.index({ userId: 1, revoked: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<IRefreshToken>('RefreshToken', refreshTokenSchema);
