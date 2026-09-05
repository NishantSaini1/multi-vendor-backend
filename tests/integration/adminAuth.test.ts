import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

const EMAIL = 'admin.test@example.com';
const PASSWORD = 'AdminPass123';

describe('Admin password auth flow', () => {
  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();
    await AdminUser.create({
      name: 'Test Admin',
      email: EMAIL,
      password: await hashPassword(PASSWORD),
      role: 'SUPER_ADMIN',
      locationIds: [],
    });
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('rejects an unknown email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: 'nobody@example.com', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a wrong password', async () => {
    const res = await request(app).post('/api/v1/auth/admin/login').send({ email: EMAIL, password: 'wrongpass' });
    expect(res.status).toBe(401);
  });

  it('logs in with correct credentials and returns tokens', async () => {
    const res = await request(app).post('/api/v1/auth/admin/login').send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.admin.password).toBeUndefined();
  });

  it('changes password and revokes existing sessions', async () => {
    const loginRes = await request(app).post('/api/v1/auth/admin/login').send({ email: EMAIL, password: PASSWORD });
    const accessToken = loginRes.body.data.accessToken;
    const refreshToken = loginRes.body.data.refreshToken;

    const changeRes = await request(app)
      .post('/api/v1/auth/admin/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: 'NewPass456' });
    expect(changeRes.status).toBe(200);

    const refreshAfterChange = await request(app).post('/api/v1/auth/admin/refresh').send({ refreshToken });
    expect(refreshAfterChange.status).toBe(401);

    const loginWithOldPassword = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(loginWithOldPassword.status).toBe(401);

    const loginWithNewPassword = await request(app)
      .post('/api/v1/auth/admin/login')
      .send({ email: EMAIL, password: 'NewPass456' });
    expect(loginWithNewPassword.status).toBe(200);
  });
});
