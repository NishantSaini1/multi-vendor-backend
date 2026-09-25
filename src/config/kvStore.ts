import { redisClient } from './redis';

// Short-lived key/value state (OTP hashes, cooldowns, attempt counters,
// password-reset tokens). Uses Redis while it's connected; otherwise falls
// back to this process's memory so these flows keep working on a single
// instance with no Redis (e.g. Render without REDIS_URL). Memory entries
// aren't shared across instances or restarts — set REDIS_URL for that.

interface MemoryEntry {
  value: string;
  expiresAt?: number;
}

const memory = new Map<string, MemoryEntry>();

function redisReady(): boolean {
  return redisClient.status === 'ready';
}

function memoryGet(key: string): string | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

// Drop expired entries now and then so abandoned keys don't pile up.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memory) {
    if (entry.expiresAt !== undefined && entry.expiresAt <= now) memory.delete(key);
  }
}, 60_000).unref();

export async function kvGet(key: string): Promise<string | null> {
  if (redisReady()) {
    // A key written to memory during an outage is still honoured after
    // Redis comes back, until it expires.
    return (await redisClient.get(key)) ?? memoryGet(key);
  }
  return memoryGet(key);
}

export async function kvSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (redisReady()) {
    await redisClient.set(key, value, 'EX', ttlSeconds);
    return;
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function kvDel(key: string): Promise<void> {
  memory.delete(key);
  if (redisReady()) await redisClient.del(key);
}

// Increments a counter and (re)sets its expiry, like INCR + EXPIRE.
export async function kvIncr(key: string, ttlSeconds: number): Promise<number> {
  if (redisReady()) {
    const value = await redisClient.incr(key);
    await redisClient.expire(key, ttlSeconds);
    return value;
  }
  const next = parseInt(memoryGet(key) ?? '0', 10) + 1;
  memory.set(key, { value: String(next), expiresAt: Date.now() + ttlSeconds * 1000 });
  return next;
}
