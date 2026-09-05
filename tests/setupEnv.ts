process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/multi-vendor-backend-test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-please-ignore';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret-please-ignore';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379/1';
process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_fixture';
process.env.RAZORPAY_SECRET = process.env.RAZORPAY_SECRET || 'test-razorpay-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'test-razorpay-webhook-secret';
