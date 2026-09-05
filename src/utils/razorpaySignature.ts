import crypto from 'crypto';
import { env } from '../config/env';

function hmacSha256Hex(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// Checkout signature: HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, key_secret).
// Sent back by Razorpay Checkout to the client after a successful payment and
// forwarded to us to verify it wasn't tampered with in transit.
export function verifyCheckoutSignature(razorpayOrderId: string, razorpayPaymentId: string, signature: string): boolean {
  const expected = hmacSha256Hex(`${razorpayOrderId}|${razorpayPaymentId}`, env.RAZORPAY_SECRET);
  return timingSafeEqualHex(expected, signature);
}

// Webhook signature: HMAC_SHA256(rawRequestBody, webhookSecret), sent in the
// `X-Razorpay-Signature` header. Must be computed over the exact raw bytes
// Razorpay sent, not a re-serialized copy of the parsed body.
export function verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
  const expected = hmacSha256Hex(rawBody.toString('utf8'), env.RAZORPAY_WEBHOOK_SECRET);
  return timingSafeEqualHex(expected, signature);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
