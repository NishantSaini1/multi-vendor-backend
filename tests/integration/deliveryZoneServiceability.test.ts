import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { Vendor } from '../../src/models/Vendor';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Delivery zones + serviceability check', () => {
  let locationId: string;
  let superAdminToken: string;

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({
      name: 'Zone City',
      code: 'ZONECITY',
      state: 'UP',
      district: 'D1',
      latitude: 10,
      longitude: 20,
      serviceRadius: 15,
    });
    locationId = location.id;

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Super', email: 'z.super@example.com', password, role: 'SUPER_ADMIN', locationIds: [] });
    superAdminToken = (
      await request(app).post('/api/v1/auth/admin/login').send({ email: 'z.super@example.com', password: 'Password123' })
    ).body.data.accessToken;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('reports not serviceable outside any location service radius', async () => {
    const res = await request(app)
      .post('/api/v1/serviceability/check')
      .send({ latitude: 60, longitude: 60, businessType: 'FOOD' });
    expect(res.status).toBe(200);
    expect(res.body.data.serviceable).toBe(false);
    expect(res.body.data.reason).toBe('OUT_OF_SERVICE_AREA');
  });

  it('reports not serviceable inside the location but with no delivery zone configured yet', async () => {
    const res = await request(app)
      .post('/api/v1/serviceability/check')
      .send({ latitude: 10, longitude: 20, businessType: 'FOOD' });
    expect(res.status).toBe(200);
    expect(res.body.data.serviceable).toBe(false);
    expect(res.body.data.reason).toBe('NO_DELIVERY_ZONE_CONFIGURED');
  });

  let zoneId: string;

  it('creates a radius-based delivery zone as SUPER_ADMIN', async () => {
    const res = await request(app)
      .post('/api/v1/delivery-zones')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        locationId,
        name: 'Central Zone',
        centerLatitude: 10,
        centerLongitude: 20,
        radius: 5,
        deliveryFee: 25,
        estimatedDeliveryTime: 35,
      });
    expect(res.status).toBe(201);
    zoneId = res.body.data._id;
  });

  it('still reports not serviceable for FOOD with no active vendor in the location', async () => {
    const res = await request(app)
      .post('/api/v1/serviceability/check')
      .send({ latitude: 10, longitude: 20, businessType: 'FOOD' });
    expect(res.status).toBe(200);
    expect(res.body.data.serviceable).toBe(false);
    expect(res.body.data.reason).toBe('NO_ACTIVE_VENDORS');
    expect(res.body.data.deliveryZone._id).toBe(zoneId);
  });

  it('reports serviceable once an active vendor exists in the location', async () => {
    await Vendor.create({
      locationId,
      restaurantName: 'Zone Restaurant',
      ownerName: 'Owner',
      phone: '9822200001',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 10,
      longitude: 20,
      status: 'ACTIVE',
    });

    const res = await request(app)
      .post('/api/v1/serviceability/check')
      .send({ latitude: 10, longitude: 20, businessType: 'FOOD' });
    expect(res.status).toBe(200);
    expect(res.body.data.serviceable).toBe(true);
    expect(res.body.data.deliveryFee).toBe(25);
    expect(res.body.data.estimatedDeliveryTime).toBe(35);
  });

  it('rejects an unauthenticated delivery zone list request', async () => {
    const res = await request(app).get('/api/v1/delivery-zones');
    expect(res.status).toBe(401);
  });
});
