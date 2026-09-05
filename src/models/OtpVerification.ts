import { Schema, model, Document, Types } from 'mongoose';

// Audit trail of OTP send/verify events. The live OTP challenge itself
// (hashed code, attempts, cooldown) lives in Redis for fast expiry handling.
export interface IOtpVerification extends Document {
  _id: Types.ObjectId;
  phone: string;
  purpose: string;
  verified: boolean;
  verifiedAt?: Date;
  ip?: string;
  createdAt: Date;
  updatedAt: Date;
}

const otpVerificationSchema = new Schema<IOtpVerification>(
  {
    phone: { type: String, required: true, index: true },
    purpose: { type: String, default: 'LOGIN' },
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date },
    ip: { type: String },
  },
  { timestamps: true },
);

otpVerificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

export const OtpVerification = model<IOtpVerification>('OtpVerification', otpVerificationSchema);
