process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/multi-vendor-backend-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-please-ignore';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-please-ignore';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379/1';
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_fixture';
process.env.RAZORPAY_SECRET = process.env.RAZORPAY_SECRET || 'test-razorpay-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test-razorpay-webhook-secret';
// Force Cloudinary "not configured" in tests regardless of what's in the
// developer's local .env — src/config/env.ts calls dotenv.config(), which
// does NOT override variables already present in process.env, so setting
// these here (before env.ts runs) keeps upload.test.ts's "Cloudinary
// unconfigured" fallback path deterministic instead of depending on whatever
// real credentials happen to be in .env on this machine.
process.env.CLOUDINARY_CLOUD_NAME = '';
process.env.CLOUDINARY_API_KEY = '';
process.env.CLOUDINARY_API_SECRET = '';
