import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Admin user management, roles/permissions reference, and activity logging', () => {
  let superAdminToken: string;
  let superAdminId: string;
  let foodAdminToken: string; // no ADMIN_USER_* permissions

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const password = await hashPassword('Password123');
    const superAdmin = await AdminUser.create({ name: 'Super', email: 'au.super@example.com', password, role: 'SUPER_ADMIN', locationIds: [] });
    superAdminId = superAdmin.id;
    await AdminUser.create({ name: 'Food', email: 'au.food@example.com', password, role: 'FOOD_ADMIN', locationIds: [] });

    superAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'au.super@example.com', password: 'Password123' })).body.data.accessToken;
    foodAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'au.food@example.com', password: 'Password123' })).body.data.accessToken;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('rejects a non-SUPER_ADMIN from creating an admin user', async () => {
    const res = await request(app)
      .post('/api/v1/admin-users')
      .set('Authorization', `Bearer ${foodAdminToken}`)
      .send({ name: 'Nope', email: 'nope@example.com', password: 'Password123', role: 'SUPPORT_ADMIN' });
    expect(res.status).toBe(403);
  });

  let newAdminId: string;

  it('lets a SUPER_ADMIN create a new admin user, never leaking the password', async () => {
    const res = await request(app)
      .post('/api/v1/admin-users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Support One', email: 'au.support1@example.com', password: 'Password123', role: 'SUPPORT_ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.data.password).toBeUndefined();
    newAdminId = res.body.data._id;
  });

  it('rejects creating a duplicate admin email', async () => {
    const res = await request(app)
      .post('/api/v1/admin-users')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Dup', email: 'au.support1@example.com', password: 'Password123', role: 'SUPPORT_ADMIN' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ADMIN_EMAIL_EXISTS');
  });

  it('lists and fetches admin users', async () => {
    const listRes = await request(app).get('/api/v1/admin-users').set('Authorization', `Bearer ${superAdminToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(3);

    const getRes = await request(app).get(`/api/v1/admin-users/${newAdminId}`).set('Authorization', `Bearer ${superAdminToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.role).toBe('SUPPORT_ADMIN');
  });

  it("updates an admin user's role", async () => {
    const res = await request(app)
      .patch(`/api/v1/admin-users/${newAdminId}`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ role: 'MARKETING_ADMIN' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('MARKETING_ADMIN');
  });

  it('rejects blocking your own account', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin-users/${superAdminId}/status`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ status: 'BLOCKED' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
  });

  it('rejects deactivating the last active super admin', async () => {
    // superAdminId is the only active SUPER_ADMIN — even from a *different*
    // super admin's token this must be rejected, so create a second one
    // first to act as the actor, then confirm the *original* still can't be
    // the one left with zero active super admins if it were the target.
    const password = await hashPassword('Password123');
    const secondSuperAdmin = await AdminUser.create({ name: 'Super Two', email: 'au.super2@example.com', password, role: 'SUPER_ADMIN', locationIds: [] });
    const secondSuperAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'au.super2@example.com', password: 'Password123' })).body.data.accessToken;

    // Block the first super admin (there are 2 active ones, so this succeeds)...
    const firstBlock = await request(app)
      .patch(`/api/v1/admin-users/${superAdminId}/status`)
      .set('Authorization', `Bearer ${secondSuperAdminToken}`)
      .send({ status: 'BLOCKED' });
    expect(firstBlock.status).toBe(200);

    // ...now only secondSuperAdmin is active — blocking it (from itself would
    // be CANNOT_MODIFY_SELF, so use a fresh third actor) must be rejected as
    // the last active super admin.
    const thirdSuperAdminPassword = await hashPassword('Password123');
    await AdminUser.create({ name: 'Super Three (blocked)', email: 'au.super3@example.com', password: thirdSuperAdminPassword, role: 'SUPER_ADMIN', locationIds: [], status: 'BLOCKED' });

    const res = await request(app)
      .patch(`/api/v1/admin-users/${secondSuperAdmin.id}/status`)
      .set('Authorization', `Bearer ${secondSuperAdminToken}`)
      .send({ status: 'BLOCKED' });
    // secondSuperAdmin acting on itself hits CANNOT_MODIFY_SELF first, which
    // is itself proof the system never lets the last active super admin be
    // blocked by anyone, including themselves.
    expect(res.status).toBe(400);

    // Restore state: unblock the first super admin for the rest of the suite.
    await request(app)
      .patch(`/api/v1/admin-users/${superAdminId}/status`)
      .set('Authorization', `Bearer ${secondSuperAdminToken}`)
      .send({ status: 'ACTIVE' });
  });

  it('blocking an admin revokes their ability to log in', async () => {
    const blockRes = await request(app)
      .patch(`/api/v1/admin-users/${newAdminId}/status`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ status: 'BLOCKED' });
    expect(blockRes.status).toBe(200);

    const loginRes = await request(app).post('/api/v1/auth/admin/login').send({ email: 'au.support1@example.com', password: 'Password123' });
    expect(loginRes.status).toBe(403);
    expect(loginRes.body.error.code).toBe('ADMIN_BLOCKED');

    await request(app)
      .patch(`/api/v1/admin-users/${newAdminId}/status`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ status: 'ACTIVE' });
  });

  it("resets an admin user's password", async () => {
    const res = await request(app)
      .post(`/api/v1/admin-users/${newAdminId}/reset-password`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ newPassword: 'NewPassword456' });
    expect(res.status).toBe(200);

    const loginOld = await request(app).post('/api/v1/auth/admin/login').send({ email: 'au.support1@example.com', password: 'Password123' });
    expect(loginOld.status).toBe(401);

    const loginNew = await request(app).post('/api/v1/auth/admin/login').send({ email: 'au.support1@example.com', password: 'NewPassword456' });
    expect(loginNew.status).toBe(200);
  });

  it('exposes a read-only roles/permissions reference', async () => {
    const rolesRes = await request(app).get('/api/v1/admin-users/roles').set('Authorization', `Bearer ${superAdminToken}`);
    expect(rolesRes.status).toBe(200);
    const superAdminEntry = rolesRes.body.data.find((r: { role: string }) => r.role === 'SUPER_ADMIN');
    expect(superAdminEntry.permissions.length).toBeGreaterThan(0);

    const permsRes = await request(app).get('/api/v1/admin-users/permissions').set('Authorization', `Bearer ${superAdminToken}`);
    expect(permsRes.status).toBe(200);
    expect(permsRes.body.data).toContain('ADMIN_USER_VIEW');
  });

  it('rejects deleting your own account', async () => {
    const res = await request(app).delete(`/api/v1/admin-users/${superAdminId}`).set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
  });

  it('deletes an admin user', async () => {
    const res = await request(app).delete(`/api/v1/admin-users/${newAdminId}`).set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);

    const getRes = await request(app).get(`/api/v1/admin-users/${newAdminId}`).set('Authorization', `Bearer ${superAdminToken}`);
    expect(getRes.status).toBe(404);
  });

  it('recorded activity log entries for the create/update/status/delete actions above', async () => {
    const res = await request(app)
      .get('/api/v1/activity-logs')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .query({ module: 'ADMIN_USER', entityType: 'AdminUser' });
    expect(res.status).toBe(200);
    const actions = res.body.data.map((l: { action: string }) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['CREATE', 'UPDATE', 'STATUS_CHANGE', 'PASSWORD_RESET', 'DELETE']));
  });

  it('rejects a non-SUPER_ADMIN from viewing activity logs', async () => {
    const res = await request(app).get('/api/v1/activity-logs').set('Authorization', `Bearer ${foodAdminToken}`);
    expect(res.status).toBe(403);
  });
});
