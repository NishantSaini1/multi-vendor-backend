import crypto from 'crypto';

export function generateOrderNumber(): string {
  const timestampPart = Date.now().toString(36).toUpperCase();
  const randomPart = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `ORD${timestampPart}${randomPart}`;
}
