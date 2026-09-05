import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { Request } from 'express';
import { redisClient } from '../config/redis';
import { env } from '../config/env';

function redisStore(prefix: string) {
  return new RedisStore({
    sendCommand: (...args: string[]) => {
      const [command, ...rest] = args;
      return redisClient.call(command, rest) as Promise<never>;
    },
    prefix: `rl:${prefix}:`,
  });
}

function phoneOrIpKey(req: Request): string {
  const phone = (req.body?.phone as string | undefined) ?? 'unknown';
  return `${phone}:${req.ip}`;
}

export const generalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore('general'),
});

export const otpSendRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: phoneOrIpKey,
  store: redisStore('otp-send'),
  message: { success: false, message: 'Too many OTP requests, please try again later', error: { code: 'OTP_RATE_LIMITED' } },
});

export const otpVerifyRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: phoneOrIpKey,
  store: redisStore('otp-verify'),
  message: { success: false, message: 'Too many OTP verification attempts', error: { code: 'OTP_VERIFY_RATE_LIMITED' } },
});

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  store: redisStore('login'),
  message: { success: false, message: 'Too many login attempts, please try again later', error: { code: 'LOGIN_RATE_LIMITED' } },
});
