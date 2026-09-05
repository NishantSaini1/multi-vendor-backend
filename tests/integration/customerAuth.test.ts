import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { Customer } from '../../src/models/Customer';
import { startTestDatabase, stopTestDatabase } from './testServer';

const PHONE = '9812300001';

describe('Customer OTP auth flow', () => {
  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('rejects an invalid phone number on send-otp', async () => {
    const res = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '123' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  let firstOtp: string;

  it('sends an OTP and exposes it in non-production for verification', async () => {
    const res = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: PHONE });
    expect(res.status).toBe(200);
    expect(res.body.data.devOtp).toMatch(/^\d{6}$/);
    firstOtp = res.body.data.devOtp;
  });

  it('rejects a wrong OTP', async () => {
    const res = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: PHONE, otp: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OTP_INVALID');
  });

  it('verifies the correct OTP, creates the customer, and returns tokens', async () => {
    // Reuses the OTP from the first send-otp call above rather than sending a new
    // one — the resend cooldown would otherwise reject a second send this soon.
    const verifyRes = await request(app)
      .post('/api/v1/auth/customer/verify-otp')
      .send({ phone: PHONE, otp: firstOtp });
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.data.accessToken).toBeDefined();
    expect(verifyRes.body.data.refreshToken).toBeDefined();
    expect(verifyRes.body.data.customer.phone).toBe(PHONE);

    const customer = await Customer.findOne({ phone: PHONE });
    expect(customer).not.toBeNull();
  });

  it('rejects protected routes without a token', async () => {
    const res = await request(app).get('/api/v1/auth/customer/me');
    expect(res.status).toBe(401);
  });

  it('returns the current customer profile with a valid access token', async () => {
    const sendRes = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9812300002' });
    const verifyRes = await request(app)
      .post('/api/v1/auth/customer/verify-otp')
      .send({ phone: '9812300002', otp: sendRes.body.data.devOtp });

    const meRes = await request(app)
      .get('/api/v1/auth/customer/me')
      .set('Authorization', `Bearer ${verifyRes.body.data.accessToken}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.phone).toBe('9812300002');
  });

  it('rotates the refresh token and revokes the old one', async () => {
    const sendRes = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9812300003' });
    const verifyRes = await request(app)
      .post('/api/v1/auth/customer/verify-otp')
      .send({ phone: '9812300003', otp: sendRes.body.data.devOtp });

    const oldRefreshToken = verifyRes.body.data.refreshToken;
    const refreshRes = await request(app).post('/api/v1/auth/customer/refresh').send({ refreshToken: oldRefreshToken });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.data.refreshToken).not.toBe(oldRefreshToken);

    const reuseRes = await request(app).post('/api/v1/auth/customer/refresh').send({ refreshToken: oldRefreshToken });
    expect(reuseRes.status).toBe(401);
  });
});
