import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { nominatimClient } from '../../src/config/nominatim';
import { hashPassword } from '../../src/utils/password';
import { AdminUser } from '../../src/models/AdminUser';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Geocoding: Nominatim forward/reverse search (mocked)', () => {
  let adminToken: string;

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Super', email: 'geo.super@example.com', password, role: 'SUPER_ADMIN', locationIds: [] });
    adminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'geo.super@example.com', password: 'Password123' })).body.data.accessToken;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('rejects an unauthenticated caller', async () => {
    const res = await request(app).get('/api/v1/geocoding/search').query({ q: 'Delhi' });
    expect(res.status).toBe(401);
  });

  it('forward-geocodes an address query', async () => {
    (jest.spyOn(nominatimClient, 'get') as unknown as jest.Mock).mockResolvedValueOnce({
      data: [{ lat: '28.6139', lon: '77.2090', display_name: 'New Delhi, India' }],
    });

    const res = await request(app).get('/api/v1/geocoding/search').set('Authorization', `Bearer ${adminToken}`).query({ q: 'New Delhi' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ latitude: 28.6139, longitude: 77.209, displayName: 'New Delhi, India' }]);
  });

  it('reverse-geocodes coordinates', async () => {
    (jest.spyOn(nominatimClient, 'get') as unknown as jest.Mock).mockResolvedValueOnce({
      data: { lat: '28.6139', lon: '77.2090', display_name: 'Connaught Place, New Delhi' },
    });

    const res = await request(app)
      .get('/api/v1/geocoding/reverse')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ latitude: '28.6139', longitude: '77.2090' });
    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe('Connaught Place, New Delhi');
  });

  it('surfaces a clear error when Nominatim is unreachable rather than crashing', async () => {
    (jest.spyOn(nominatimClient, 'get') as unknown as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(app).get('/api/v1/geocoding/search').set('Authorization', `Bearer ${adminToken}`).query({ q: 'Delhi' });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('GEOCODING_UNAVAILABLE');
  });

  it('rejects a query that is too short', async () => {
    const res = await request(app).get('/api/v1/geocoding/search').set('Authorization', `Bearer ${adminToken}`).query({ q: 'a' });
    expect(res.status).toBe(422);
  });
});
