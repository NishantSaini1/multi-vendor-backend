import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { Vendor } from '../../src/models/Vendor';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Banners: admin CRUD and the public "active banners" query', () => {
  let locationId: string;
  let marketingToken: string;
  let vendorId: string;

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({ name: 'Banner City', code: 'BANNERCITY', state: 'UP', district: 'D1', latitude: 22, longitude: 22 });
    locationId = location.id;

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Marketing', email: 'bn.marketing@example.com', password, role: 'MARKETING_ADMIN', locationIds: [] });
    marketingToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'bn.marketing@example.com', password: 'Password123' })).body.data.accessToken;

    const vendor = await Vendor.create({
      locationId,
      restaurantName: 'Banner Restaurant',
      ownerName: 'Owner',
      phone: '9877100001',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 22,
      longitude: 22,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      isOpen: true,
    });
    vendorId = vendor.id;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('rejects a VENDOR-placement banner with no vendorId', async () => {
    const res = await request(app)
      .post('/api/v1/banners')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ title: 'Bad banner', image: 'https://example.com/a.png', placement: 'VENDOR', sortOrder: 0 });
    expect(res.status).toBe(422);
  });

  let globalBannerId: string;

  it('creates a GLOBAL banner and a VENDOR banner, sortOrder controlling ranking', async () => {
    const globalRes = await request(app)
      .post('/api/v1/banners')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ title: 'Global banner 2', image: 'https://example.com/g2.png', placement: 'GLOBAL', sortOrder: 2 });
    globalBannerId = globalRes.body.data._id;

    await request(app)
      .post('/api/v1/banners')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ title: 'Global banner 1', image: 'https://example.com/g1.png', placement: 'GLOBAL', sortOrder: 1 });

    await request(app)
      .post('/api/v1/banners')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ title: 'Vendor banner', image: 'https://example.com/v.png', placement: 'VENDOR', vendorId, sortOrder: 0 });
  });

  it('public /banners/active returns GLOBAL banners ranked by sortOrder, without auth', async () => {
    const res = await request(app).get('/api/v1/banners/active').query({ placement: 'GLOBAL' });
    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { title: string }) => b.title)).toEqual(['Global banner 1', 'Global banner 2']);
  });

  it('scopes VENDOR placement banners to the given vendorId only', async () => {
    const res = await request(app).get('/api/v1/banners/active').query({ placement: 'VENDOR', vendorId });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].title).toBe('Vendor banner');

    const noneRes = await request(app).get('/api/v1/banners/active').query({ placement: 'VENDOR', vendorId: '507f1f77bcf86cd799439011' });
    expect(noneRes.body.data).toHaveLength(0);
  });

  it('excludes an INACTIVE banner from the active query', async () => {
    await request(app)
      .patch(`/api/v1/banners/${globalBannerId}/status`)
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ status: 'INACTIVE' });

    const res = await request(app).get('/api/v1/banners/active').query({ placement: 'GLOBAL' });
    expect(res.body.data.map((b: { title: string }) => b.title)).not.toContain('Global banner 2');
  });

  it('updates and then deletes a banner', async () => {
    const update = await request(app)
      .patch(`/api/v1/banners/${globalBannerId}`)
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ sortOrder: 5 });
    expect(update.status).toBe(200);
    expect(update.body.data.sortOrder).toBe(5);

    const del = await request(app).delete(`/api/v1/banners/${globalBannerId}`).set('Authorization', `Bearer ${marketingToken}`);
    expect(del.status).toBe(200);

    const getRes = await request(app).get(`/api/v1/banners/${globalBannerId}`).set('Authorization', `Bearer ${marketingToken}`);
    expect(getRes.status).toBe(404);
  });
});
