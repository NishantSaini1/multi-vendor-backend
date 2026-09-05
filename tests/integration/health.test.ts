import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('GET /api/v1/health', () => {
  beforeAll(async () => {
    await startTestDatabase();
  });

  afterAll(async () => {
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('reports database and redis connectivity', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.database).toBe('connected');
  });
});
