import rateLimit, { MemoryStore, Options, Store } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { Request } from 'express';
import { redisClient, isRedisConfigured } from '../config/redis';
import { env } from '../config/env';

// Uses Redis while it's actually connected and the per-process MemoryStore
// otherwise, so limits keep applying (just not shared across instances)
// instead of every request failing when Redis is missing or down.
class RedisWithMemoryFallbackStore implements Store {
  prefix: string;
  private readonly memory = new MemoryStore();

  constructor(
    prefix: string,
    private readonly redis: RedisStore | undefined,
  ) {
    this.prefix = prefix;
  }

  private active(): Store {
    return this.redis && redisClient.status === 'ready' ? this.redis : this.memory;
  }

  init(options: Options) {
    this.memory.init(options);
    this.redis?.init(options);
  }

  get(key: string) {
    return this.active().get?.(key);
  }

  increment(key: string) {
    return this.active().increment(key);
  }

  decrement(key: string) {
    return this.active().decrement(key);
  }

  resetKey(key: string) {
    return this.active().resetKey(key);
  }
}

function redisStore(prefix: string): Store {
  const fullPrefix = `rl:${prefix}:`;
  if (!isRedisConfigured) return new RedisWithMemoryFallbackStore(fullPrefix, undefined);
  const store = new RedisStore({
    sendCommand: (...args: string[]) => {
      const [command, ...rest] = args;
      return redisClient.call(command, rest) as Promise<never>;
    },
    prefix: fullPrefix,
  });
  // The constructor fires SCRIPT LOAD at import time. If Redis isn't
  // reachable yet those promises reject with nobody awaiting them, which
  // crashes the process. The store reloads the scripts on the next
  // increment/get anyway, so the initial failure is safe to ignore.
  store.incrementScriptSha.catch(() => undefined);
  store.getScriptSha.catch(() => undefined);
  return new RedisWithMemoryFallbackStore(fullPrefix, store);
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
  // Let requests through rather than 500 every route while Redis is down.
  passOnStoreError: true,
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
