import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Delivery partners: CRUD, self-service, and availability discovery', () => {
  let locationId: string;
  let superAdminToken: string;
  let partnerId: string;
  let partnerToken: string;

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({
      name: 'Delivery City',
      code: 'DELIVCITY',
      state: 'UP',
      district: 'D1',
      latitude: 20,
      longitude: 30,
    });
    locationId = location.id;

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Super', email: 'd.super@example.com', password, role: 'SUPER_ADMIN', locationIds: [] });
    superAdminToken = (
      await request(app).post('/api/v1/auth/admin/login').send({ email: 'd.super@example.com', password: 'Password123' })
    ).body.data.accessToken;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('creates a delivery partner without leaking the password, in PENDING status', async () => {
    const res = await request(app)
      .post('/api/v1/delivery-partners')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ locationId, name: 'Rider One', phone: '9866600001', password: 'RiderPass123' });
    expect(res.status).toBe(201);
    expect(res.body.data.password).toBeUndefined();
    expect(res.body.data.status).toBe('PENDING');
    partnerId = res.body.data._id;
  });

  it('blocks login while status is PENDING', async () => {
    const res = await request(app)
      .post('/api/v1/auth/delivery/login')
      .send({ phone: '9866600001', password: 'RiderPass123' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DELIVERY_PARTNER_NOT_ACTIVE');
  });

  it('approves the partner, after which login succeeds', async () => {
    const approveRes = await request(app)
      .post(`/api/v1/delivery-partners/${partnerId}/approve`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.status).toBe('ACTIVE');

    const loginRes = await request(app)
      .post('/api/v1/auth/delivery/login')
      .send({ phone: '9866600001', password: 'RiderPass123' });
    expect(loginRes.status).toBe(200);
    partnerToken = loginRes.body.data.accessToken;
  });

  it('rejects availability changes before a location has ever been set (still allowed, just no geo entry)', async () => {
    const res = await request(app)
      .patch(`/api/v1/delivery-partners/${partnerId}/availability`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ availability: 'ONLINE' });
    expect(res.status).toBe(200);
    expect(res.body.data.availability).toBe('ONLINE');
  });

  it("lets the partner update their own location, but forbids another partner's token from doing so", async () => {
    const otherPartner = await request(app)
      .post('/api/v1/delivery-partners')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ locationId, name: 'Rider Two', phone: '9866600002', password: 'RiderPass123' });
    await request(app)
      .post(`/api/v1/delivery-partners/${otherPartner.body.data._id}/approve`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    const otherLogin = await request(app)
      .post('/api/v1/auth/delivery/login')
      .send({ phone: '9866600002', password: 'RiderPass123' });
    const otherToken = otherLogin.body.data.accessToken;

    const forbiddenRes = await request(app)
      .post(`/api/v1/delivery-partners/${partnerId}/location`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ latitude: 20.001, longitude: 30.001 });
    expect(forbiddenRes.status).toBe(403);

    const okRes = await request(app)
      .post(`/api/v1/delivery-partners/${partnerId}/location`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ latitude: 20.001, longitude: 30.001 });
    expect(okRes.status).toBe(200);
  });

  it('surfaces the online partner in the nearby available-partners search', async () => {
    const res = await request(app)
      .get('/api/v1/delivery/available-partners')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .query({ locationId, latitude: '20.001', longitude: '30.001', radiusKm: '5' });
    expect(res.status).toBe(200);
    expect(res.body.data.some((p: { id: string }) => p.id === partnerId)).toBe(true);
  });

  it('removes the partner from available-partners once they go OFFLINE', async () => {
    await request(app)
      .patch(`/api/v1/delivery-partners/${partnerId}/availability`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ availability: 'OFFLINE' });

    const res = await request(app)
      .get('/api/v1/delivery/available-partners')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .query({ locationId, latitude: '20.001', longitude: '30.001', radiusKm: '5' });
    expect(res.body.data.some((p: { id: string }) => p.id === partnerId)).toBe(false);
  });

  it('lets the partner set their own vehicle', async () => {
    const res = await request(app)
      .put(`/api/v1/delivery-partners/${partnerId}/vehicle`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ type: 'BIKE', registrationNumber: 'DL01AB1234' });
    expect(res.status).toBe(200);
    expect(res.body.data.registrationNumber).toBe('DL01AB1234');
  });

  it('rejects an unauthenticated request to list delivery partners', async () => {
    const res = await request(app).get('/api/v1/delivery-partners');
    expect(res.status).toBe(401);
  });

  it("forbids a delivery partner token from listing all partners (admin-only)", async () => {
    const res = await request(app).get('/api/v1/delivery-partners').set('Authorization', `Bearer ${partnerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('USER_TYPE_FORBIDDEN');
  });
});
