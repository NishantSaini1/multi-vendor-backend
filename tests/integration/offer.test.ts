import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { Vendor } from '../../src/models/Vendor';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Offers: admin CRUD and the public "active offers" query', () => {
  let locationId: string;
  let otherLocationId: string;
  let marketingToken: string;
  let vendorId: string;

  function farPastDate() {
    return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  }
  function farFutureDate() {
    return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  }

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({ name: 'Offer City', code: 'OFFERCITY', state: 'UP', district: 'D1', latitude: 20, longitude: 20 });
    locationId = location.id;
    const otherLocation = await Location.create({ name: 'Other Offer City', code: 'OTHEROFFERCITY', state: 'UP', district: 'D2', latitude: 21, longitude: 21 });
    otherLocationId = otherLocation.id;

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Marketing', email: 'of.marketing@example.com', password, role: 'MARKETING_ADMIN', locationIds: [] });
    marketingToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'of.marketing@example.com', password: 'Password123' })).body.data.accessToken;

    const vendor = await Vendor.create({
      locationId,
      restaurantName: 'Offer Restaurant',
      ownerName: 'Owner',
      phone: '9877200001',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 20,
      longitude: 20,
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

  let globalOfferId: string;

  it('lets a MARKETING_ADMIN create a location-unscoped (global) offer', async () => {
    const res = await request(app)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ title: '20% off everywhere', discountType: 'PERCENTAGE', discountValue: 20, startDate: farPastDate(), endDate: farFutureDate() });
    expect(res.status).toBe(201);
    globalOfferId = res.body.data._id;
  });

  it('creates a location-scoped offer and a vendor-scoped offer', async () => {
    await request(app)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ title: 'Offer City special', discountType: 'FIXED', discountValue: 50, locationIds: [locationId], startDate: farPastDate(), endDate: farFutureDate() });

    await request(app)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ title: 'Just for this vendor', discountType: 'FIXED', discountValue: 30, vendorIds: [vendorId], startDate: farPastDate(), endDate: farFutureDate() });
  });

  it('creates a not-yet-started offer and an already-ended offer, neither of which should appear as active', async () => {
    await request(app)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ title: 'Future offer', discountType: 'FIXED', discountValue: 10, startDate: farFutureDate(), endDate: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() });

    await request(app)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ title: 'Past offer', discountType: 'FIXED', discountValue: 10, startDate: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), endDate: farPastDate() });
  });

  it('public /offers/active returns the global offer everywhere, without auth', async () => {
    const res = await request(app).get('/api/v1/offers/active');
    expect(res.status).toBe(200);
    const titles = res.body.data.map((o: { title: string }) => o.title);
    expect(titles).toContain('20% off everywhere');
    expect(titles).not.toContain('Future offer');
    expect(titles).not.toContain('Past offer');
  });

  it('scopes by locationId, still including unscoped (global) offers', async () => {
    const res = await request(app).get('/api/v1/offers/active').query({ locationId });
    const titles = res.body.data.map((o: { title: string }) => o.title);
    expect(titles).toContain('Offer City special');
    expect(titles).toContain('20% off everywhere');

    const otherRes = await request(app).get('/api/v1/offers/active').query({ locationId: otherLocationId });
    const otherTitles = otherRes.body.data.map((o: { title: string }) => o.title);
    expect(otherTitles).not.toContain('Offer City special');
    expect(otherTitles).toContain('20% off everywhere');
  });

  it('scopes by vendorId to just that vendor\'s offer plus unscoped ones', async () => {
    const res = await request(app).get('/api/v1/offers/active').query({ vendorId });
    const titles = res.body.data.map((o: { title: string }) => o.title);
    expect(titles).toContain('Just for this vendor');
    expect(titles).toContain('20% off everywhere');
  });

  it('rejects a non-MARKETING_ADMIN role from managing offers', async () => {
    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Support', email: 'of.support@example.com', password, role: 'SUPPORT_ADMIN', locationIds: [] });
    const supportToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'of.support@example.com', password: 'Password123' })).body.data.accessToken;

    const res = await request(app)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${supportToken}`)
      .send({ title: 'Should not work', discountType: 'FIXED', discountValue: 5, startDate: farPastDate(), endDate: farFutureDate() });
    expect(res.status).toBe(403);
  });

  it('updates and then deletes an offer', async () => {
    const update = await request(app)
      .patch(`/api/v1/offers/${globalOfferId}`)
      .set('Authorization', `Bearer ${marketingToken}`)
      .send({ discountValue: 25 });
    expect(update.status).toBe(200);
    expect(update.body.data.discountValue).toBe(25);

    const del = await request(app).delete(`/api/v1/offers/${globalOfferId}`).set('Authorization', `Bearer ${marketingToken}`);
    expect(del.status).toBe(200);

    const getRes = await request(app).get(`/api/v1/offers/${globalOfferId}`).set('Authorization', `Bearer ${marketingToken}`);
    expect(getRes.status).toBe(404);
  });
});
