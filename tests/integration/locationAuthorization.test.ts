import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Location-based admin authorization', () => {
  let locationA: string;
  let locationB: string;
  let scopedAdminToken: string;
  let superAdminToken: string;

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const locA = await Location.create({
      name: 'Location A',
      code: 'LOCA',
      state: 'UP',
      district: 'D1',
      latitude: 1,
      longitude: 1,
    });
    const locB = await Location.create({
      name: 'Location B',
      code: 'LOCB',
      state: 'UP',
      district: 'D2',
      latitude: 2,
      longitude: 2,
    });
    locationA = locA.id;
    locationB = locB.id;

    const password = await hashPassword('Password123');
    await AdminUser.create({
      name: 'Scoped Admin',
      email: 'scoped.admin@example.com',
      password,
      role: 'LOCATION_ADMIN',
      locationIds: [locationA],
    });
    await AdminUser.create({
      name: 'Super Admin',
      email: 'super.admin@example.com',
      password,
      role: 'SUPER_ADMIN',
      locationIds: [],
    });

    const scopedLogin = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'scoped.admin@example.com', password: 'Password123' });
    scopedAdminToken = scopedLogin.body.data.accessToken;

    const superLogin = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'super.admin@example.com', password: 'Password123' });
    superAdminToken = superLogin.body.data.accessToken;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('allows a LOCATION_ADMIN to view their own assigned location', async () => {
    const res = await request(app)
      .get(`/api/v1/locations/${locationA}`)
      .set('Authorization', `Bearer ${scopedAdminToken}`);
    expect(res.status).toBe(200);
  });

  it('forbids a LOCATION_ADMIN from viewing a location outside their assignment', async () => {
    const res = await request(app)
      .get(`/api/v1/locations/${locationB}`)
      .set('Authorization', `Bearer ${scopedAdminToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('LOCATION_FORBIDDEN');
  });

  it('allows a SUPER_ADMIN to access any location', async () => {
    const res = await request(app)
      .get(`/api/v1/locations/${locationB}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
  });
});
