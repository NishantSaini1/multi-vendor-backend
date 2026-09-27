import request from 'supertest';
import { Types } from 'mongoose';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Customer self-service: profile edit and synced favourites', () => {
  let token: string;
  let otherToken: string;

  async function customer(phone: string) {
    const send = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone });
    const verify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone, otp: send.body.data.devOtp });
    return verify.body.data.accessToken as string;
  }

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();
    token = await customer('9877500001');
    otherToken = await customer('9877500002');
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  describe('PATCH /auth/customer/me', () => {
    it('persists name, email and photo', async () => {
      const res = await request(app)
        .patch('/api/v1/auth/customer/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Asha Verma', email: 'Asha@Example.com', profileImage: 'https://example.com/a.jpg' });
      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('asha@example.com');

      const me = await request(app).get('/api/v1/auth/customer/me').set('Authorization', `Bearer ${token}`);
      expect(me.body.data.name).toBe('Asha Verma');
      expect(me.body.data.profileImage).toBe('https://example.com/a.jpg');
    });

    it('clears a field with an empty string', async () => {
      const res = await request(app).patch('/api/v1/auth/customer/me').set('Authorization', `Bearer ${token}`).send({ profileImage: '' });
      expect(res.status).toBe(200);
      expect(res.body.data.profileImage).toBeUndefined();
    });

    it('rejects an email already used by someone else', async () => {
      const res = await request(app).patch('/api/v1/auth/customer/me').set('Authorization', `Bearer ${otherToken}`).send({ email: 'asha@example.com' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EMAIL_IN_USE');
    });

    it('does not allow changing the phone or other fields here', async () => {
      const res = await request(app).patch('/api/v1/auth/customer/me').set('Authorization', `Bearer ${token}`).send({ phone: '9000000000' });
      expect(res.status).toBe(422); // this API's validation-error status
    });
  });

  describe('/favorites', () => {
    const vendorId = new Types.ObjectId().toString();
    const productId = new Types.ObjectId().toString();

    it('adds favourites idempotently and lists only your own', async () => {
      for (let i = 0; i < 2; i += 1) {
        const r = await request(app)
          .post('/api/v1/favorites')
          .set('Authorization', `Bearer ${token}`)
          .send({ type: 'VENDOR', targetId: vendorId, name: 'Spice Junction' });
        expect(r.status).toBe(201);
      }
      const list = await request(app).get('/api/v1/favorites').set('Authorization', `Bearer ${token}`);
      expect(list.body.data).toHaveLength(1);
      // the vendor doesn't exist in this test DB → flagged, not dropped
      expect(list.body.data[0].live.exists).toBe(false);

      const other = await request(app).get('/api/v1/favorites').set('Authorization', `Bearer ${otherToken}`);
      expect(other.body.data).toHaveLength(0);
    });

    it('imports device-saved favourites without overwriting server ones', async () => {
      const res = await request(app)
        .post('/api/v1/favorites/import')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { type: 'VENDOR', targetId: vendorId, name: 'Stale local name' },
            { type: 'PRODUCT', targetId: productId, name: 'Veg Burger', meta: { businessType: 'FOOD', vendorId } },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body.data.imported).toBe(1);
      const list = await request(app).get('/api/v1/favorites').set('Authorization', `Bearer ${token}`);
      expect(list.body.data).toHaveLength(2);
      expect(list.body.data.find((f: { type: string }) => f.type === 'VENDOR').name).toBe('Spice Junction');
    });

    it('removes a favourite', async () => {
      const del = await request(app).delete(`/api/v1/favorites/PRODUCT/${productId}`).set('Authorization', `Bearer ${token}`);
      expect(del.status).toBe(200);
      const list = await request(app).get('/api/v1/favorites').set('Authorization', `Bearer ${token}`);
      expect(list.body.data).toHaveLength(1);
    });

    it('requires a customer token', async () => {
      const res = await request(app).get('/api/v1/favorites');
      expect(res.status).toBe(401);
    });
  });
});
