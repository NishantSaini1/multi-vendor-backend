import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Uploads: validation and the graceful "Cloudinary not configured" path', () => {
  let customerToken: string;

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9877990001' });
    const verify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9877990001', otp: sendOtp.body.data.devOtp });
    customerToken = verify.body.data.accessToken;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('rejects an unauthenticated upload', async () => {
    const res = await request(app).post('/api/v1/uploads').attach('image', Buffer.from('fake-png'), 'a.png');
    expect(res.status).toBe(401);
  });

  it('rejects a request with no file', async () => {
    const res = await request(app).post('/api/v1/uploads').set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FILE_REQUIRED');
  });

  it('rejects a non-image file type', async () => {
    const res = await request(app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${customerToken}`)
      .attach('image', Buffer.from('not an image'), { filename: 'notes.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
  });

  it('rejects a file over the 5MB limit', async () => {
    const oversized = Buffer.alloc(6 * 1024 * 1024, 1);
    const res = await request(app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${customerToken}`)
      .attach('image', oversized, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UPLOAD_LIMIT_FILE_SIZE');
  });

  it('accepts a valid image but fails gracefully since Cloudinary is unconfigured in tests', async () => {
    const res = await request(app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${customerToken}`)
      .attach('image', Buffer.from('fake-png-bytes'), { filename: 'photo.png', contentType: 'image/png' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('UPLOAD_NOT_CONFIGURED');
  });

  it('requires a publicId to delete an image', async () => {
    const res = await request(app).delete('/api/v1/uploads').set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PUBLIC_ID_REQUIRED');
  });
});
