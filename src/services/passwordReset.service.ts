import crypto from 'crypto';
import { redisClient } from '../config/redis';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { UserType } from '../constants/roles';
import { getMailTransporter } from '../config/mail';
import { logger } from '../utils/logger';

const RESET_TOKEN_TTL_SECONDS = 15 * 60;

function resetKey(userType: UserType, userId: string): string {
  return `pwreset:${userType}:${userId}`;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(`${token}:${env.JWT_SECRET}`).digest('hex');
}

export interface CreateResetTokenResult {
  devResetToken?: string;
}

export async function createResetToken(
  userType: UserType,
  userId: string,
  email?: string,
): Promise<CreateResetTokenResult> {
  const secret = crypto.randomBytes(24).toString('hex');
  // Self-describing token so /reset-password doesn't need userId/userType as separate inputs.
  const token = Buffer.from(`${userType}.${userId}.${secret}`).toString('base64url');
  await redisClient.set(resetKey(userType, userId), hashToken(secret), 'EX', RESET_TOKEN_TTL_SECONDS);

  const transporter = getMailTransporter();
  if (email && transporter) {
    await transporter.sendMail({
      from: env.SMTP_FROM,
      to: email,
      subject: 'Password reset request',
      text: `Use this token to reset your password (valid for 15 minutes): ${token}`,
    });
  } else {
    logger.warn({ userType, userId }, 'Password reset requested but no email/SMTP available to deliver token');
  }

  return env.isProduction ? {} : { devResetToken: token };
}

export interface DecodedResetToken {
  userType: UserType;
  userId: string;
}

export function decodeResetToken(token: string): DecodedResetToken & { secret: string } {
  let decoded: string;
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    throw ApiError.badRequest('Invalid or expired reset token', 'RESET_TOKEN_INVALID');
  }
  const [userType, userId, secret] = decoded.split('.');
  if (!userType || !userId || !secret) {
    throw ApiError.badRequest('Invalid or expired reset token', 'RESET_TOKEN_INVALID');
  }
  return { userType: userType as UserType, userId, secret };
}

export async function consumeResetToken(token: string): Promise<DecodedResetToken> {
  const { userType, userId, secret } = decodeResetToken(token);
  const key = resetKey(userType, userId);
  const storedHash = await redisClient.get(key);
  if (!storedHash || storedHash !== hashToken(secret)) {
    throw ApiError.badRequest('Invalid or expired reset token', 'RESET_TOKEN_INVALID');
  }
  await redisClient.del(key);
  return { userType, userId };
}
