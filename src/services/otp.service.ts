import { redisClient } from '../config/redis';
import { env } from '../config/env';
import { generateOtp, hashOtp, verifyOtpHash } from '../utils/otp';
import { ApiError } from '../utils/ApiError';
import { OtpVerification } from '../models/OtpVerification';
import { logger } from '../utils/logger';

function otpKey(phone: string): string {
  return `otp:customer:${phone}`;
}
function attemptsKey(phone: string): string {
  return `otp:attempts:customer:${phone}`;
}
function cooldownKey(phone: string): string {
  return `otp:cooldown:customer:${phone}`;
}

export interface SendOtpResult {
  expiresInSeconds: number;
  // Only populated outside production, per spec section 7.
  devOtp?: string;
}

// Never honored in production, regardless of TEST_OTP_PHONES config — this
// exists purely so a fixed number can be re-verified with the same OTP across
// manual/Postman test runs instead of fetching a fresh devOtp every time.
function isTestPhone(phone: string): boolean {
  return !env.isProduction && env.TEST_OTP_PHONES_LIST.includes(phone);
}

export async function sendOtp(phone: string): Promise<SendOtpResult> {
  console.log('🔥 sendOtp called:', phone);

  const cooldownKeyValue = cooldownKey(phone);
  console.log('🔥 cooldown key:', cooldownKeyValue);

  const onCooldown = await redisClient.get(cooldownKeyValue);
  console.log('🔥 onCooldown:', onCooldown);

  if (onCooldown) {
    console.log('❌ OTP blocked because cooldown is active');

    throw ApiError.tooManyRequests(
      'Please wait before requesting another OTP',
      'OTP_COOLDOWN_ACTIVE'
    );
  }

  console.log('🔥 TEST_OTP_CODE:', env.TEST_OTP_CODE);
  console.log('🔥 TEST_OTP_PHONES_LIST:', env.TEST_OTP_PHONES_LIST);
  console.log('🔥 isProduction:', env.isProduction);
  console.log('🔥 isTestPhone:', isTestPhone(phone));

  const otp = isTestPhone(phone)
    ? env.TEST_OTP_CODE
    : generateOtp();

  console.log('🔥 Generated OTP:', otp);

  const hashed = hashOtp(otp, phone);
  const expirySeconds = env.OTP_EXPIRY_MINUTES * 60;

  await redisClient.set(
    otpKey(phone),
    hashed,
    'EX',
    expirySeconds
  );

  await redisClient.set(
    cooldownKey(phone),
    '1',
    'EX',
    env.OTP_RESEND_COOLDOWN_SECONDS
  );

  await redisClient.del(attemptsKey(phone));

  if (env.isDevelopment) {
    logger.info({ phone }, `Dev OTP generated: ${otp}`);
  }

  await OtpVerification.create({
    phone,
    purpose: 'LOGIN',
  });

  return {
    expiresInSeconds: expirySeconds,
    ...(env.isProduction ? {} : { devOtp: otp }),
  };
}

export async function verifyOtp(phone: string, otp: string): Promise<void> {
  const storedHash = await redisClient.get(otpKey(phone));
  if (!storedHash) {
    throw ApiError.badRequest('OTP has expired or was never sent', 'OTP_EXPIRED');
  }

  const attempts = parseInt((await redisClient.get(attemptsKey(phone))) ?? '0', 10);
  if (attempts >= env.OTP_MAX_ATTEMPTS) {
    await redisClient.del(otpKey(phone));
    throw ApiError.tooManyRequests('Maximum OTP attempts exceeded, please request a new OTP', 'OTP_MAX_ATTEMPTS');
  }

  const isValid = verifyOtpHash(otp, phone, storedHash);
  if (!isValid) {
    await redisClient.incr(attemptsKey(phone));
    await redisClient.expire(attemptsKey(phone), env.OTP_EXPIRY_MINUTES * 60);
    throw ApiError.badRequest('Invalid OTP', 'OTP_INVALID');
  }

  await redisClient.del(otpKey(phone));
  await redisClient.del(attemptsKey(phone));

  const latestUnverified = await OtpVerification.findOne({ phone, verified: false }).sort({ createdAt: -1 });
  if (latestUnverified) {
    latestUnverified.verified = true;
    latestUnverified.verifiedAt = new Date();
    await latestUnverified.save();
  }
}
