import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_VERSION: z.string().default('v1'),

  CLIENT_URL: z.string().default('http://localhost:3000'),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_ADMIN_EXPIRES_IN: z.string().default('12h'),
  JWT_VENDOR_EXPIRES_IN: z.string().default('24h'),

  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  OTP_EXPIRY_MINUTES: z.coerce.number().default(5),
  OTP_LENGTH: z.coerce.number().default(6),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().default(60),

  // Comma-separated phone numbers that always get a fixed OTP (TEST_OTP_CODE)
  // instead of a random one, for repeatable manual/Postman testing without
  // needing to re-fetch a fresh devOtp each time. Never honored in production
  // (see otp.service.ts) regardless of what's configured here.
  TEST_OTP_PHONES: z.string().optional().default('9810000000'),
  TEST_OTP_CODE: z.string().default('123456'),

  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  NOMINATIM_USER_AGENT: z.string().default('multi-vendor-backend/1.0'),

  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),

  RAZORPAY_KEY_ID: z.string().optional().default(''),
  RAZORPAY_SECRET: z.string().optional().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),

  ONESIGNAL_APP_ID: z.string().optional().default(''),
  ONESIGNAL_API_KEY: z.string().optional().default(''),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default('no-reply@example.com'),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(200),
  // Per phone+IP, per 15 min. Raise in development so repeated test logins
  // don't lock the number out.
  OTP_SEND_RATE_LIMIT_MAX: z.coerce.number().default(5),
  OTP_VERIFY_RATE_LIMIT_MAX: z.coerce.number().default(10),

  // How long an order can sit PENDING (unconfirmed by the vendor/store)
  // before the background sweep auto-cancels it.
  ORDER_TIMEOUT_MINUTES: z.coerce.number().default(30),
  NOTIFICATION_RETRY_MAX_ATTEMPTS: z.coerce.number().default(3),

  // The platform's cut of the delivery fee, as a percentage — a delivery
  // partner's own earning on a delivery (Delivery.partnerEarning) is the
  // order's deliveryFee net of this margin. Set at assignment time (see
  // delivery.service.ts's assignDeliveryPartner). COMMISSION_LEVELS/Commission
  // has no DELIVERY_PARTNER level (delivery partners keep 100% of their
  // earnings under that model — see settlement.service.ts), so this is a
  // separate, simpler flat percentage rather than a full Commission rule.
  PLATFORM_DELIVERY_MARGIN_PERCENT: z.coerce.number().default(20),

  LOG_LEVEL: z.string().default('info'),

  BCRYPT_SALT_ROUNDS: z.coerce.number().default(12),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

export const env = {
  ...parsed.data,
  CLIENT_URLS: parsed.data.CLIENT_URL.split(',').map((u) => u.trim()).filter(Boolean),
  TEST_OTP_PHONES_LIST: parsed.data.TEST_OTP_PHONES.split(',').map((p) => p.trim()).filter(Boolean),
  isProduction: parsed.data.NODE_ENV === 'production',
  isDevelopment: parsed.data.NODE_ENV === 'development',
  isTest: parsed.data.NODE_ENV === 'test',
};
