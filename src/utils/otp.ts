import crypto from 'crypto';
import { env } from '../config/env';

export function generateOtp(): string {
  const min = 10 ** (env.OTP_LENGTH - 1);
  const max = 10 ** env.OTP_LENGTH - 1;
  return crypto.randomInt(min, max + 1).toString();
}

export function hashOtp(otp: string, phone: string): string {
  return crypto.createHash('sha256').update(`${otp}:${phone}:${env.JWT_SECRET}`).digest('hex');
}

export function verifyOtpHash(otp: string, phone: string, hash: string): boolean {
  const candidate = hashOtp(otp, phone);
  const candidateBuf = Buffer.from(candidate, 'hex');
  const hashBuf = Buffer.from(hash, 'hex');
  if (candidateBuf.length !== hashBuf.length) return false;
  return crypto.timingSafeEqual(candidateBuf, hashBuf);
}
