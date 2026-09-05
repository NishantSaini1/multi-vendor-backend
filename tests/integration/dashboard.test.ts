import mongoose from 'mongoose';
import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { Vendor } from '../../src/models/Vendor';
import { Order } from '../../src/models/Order';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Dashboard: aggregated overview and orders trend', () => {
  let locationId: string;
  let superAdminToken: string;
  let marketingAdminToken: string; // no DASHBOARD_VIEW

  async function insertOrder(status: string, total: number, daysAgo = 0) {
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - daysAgo);
    await Order.create({
      orderNumber: `DASH-${new mongoose.Types.ObjectId().toString()}`,
      locationId,
      businessType: 'FOOD',
      customerId: new mongoose.Types.ObjectId(),
      vendorId: new mongoose.Types.ObjectId(),
      subtotal: total,
      total,
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      deliveryAddress: { address: 'Somewhere', pincode: '110001', latitude: 27, longitude: 27 },
      status,
      createdAt,
      updatedAt: createdAt,
    });
  }

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({ name: 'Dashboard City', code: 'DASHCITY', state: 'UP', district: 'D1', latitude: 27, longitude: 27 });
    locationId = location.id;

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Super', email: 'db.super@example.com', password, role: 'SUPER_ADMIN', locationIds: [] });
    await AdminUser.create({ name: 'Marketing', email: 'db.marketing@example.com', password, role: 'MARKETING_ADMIN', locationIds: [] });
    superAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'db.super@example.com', password: 'Password123' })).body.data.accessToken;
    marketingAdminToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'db.marketing@example.com', password: 'Password123' })).body.data.accessToken;

    await Vendor.create({
      locationId,
      restaurantName: 'Dashboard Restaurant',
      ownerName: 'Owner',
      phone: '9877880010',
      password: await hashPassword('VendorPass123'),
      address: 'Somewhere',
      latitude: 27,
      longitude: 27,
      status: 'ACTIVE',
      approvalStatus: 'PENDING',
      isOpen: true,
    });

    await insertOrder('DELIVERED', 300, 0);
    await insertOrder('DELIVERED', 200, 0);
    await insertOrder('CANCELLED', 150, 0);
    await insertOrder('PENDING', 100, 5); // outside today's window
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('rejects a role without DASHBOARD_VIEW', async () => {
    const res = await request(app).get('/api/v1/dashboard/overview').set('Authorization', `Bearer ${marketingAdminToken}`);
    expect(res.status).toBe(403);
  });

  it("aggregates today's order counts/revenue by status, plus vendor pending approvals", async () => {
    const res = await request(app).get('/api/v1/dashboard/overview').set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.orders.totalOrders).toBe(3); // the 3 orders created "today", not the 5-day-old one
    expect(res.body.data.orders.totalRevenue).toBe(300 + 200 + 150);
    expect(res.body.data.orders.byStatus.DELIVERED).toBe(2);
    expect(res.body.data.orders.byStatus.CANCELLED).toBe(1);
    expect(res.body.data.vendors.pendingApprovals).toBeGreaterThanOrEqual(1);
  });

  it('respects an explicit from/to date range', async () => {
    const from = new Date();
    from.setDate(from.getDate() - 10);
    const res = await request(app)
      .get('/api/v1/dashboard/overview')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .query({ from: from.toISOString() });
    expect(res.status).toBe(200);
    expect(res.body.data.orders.totalOrders).toBe(4); // now includes the 5-day-old one too
  });

  it('groups the orders trend by day', async () => {
    const res = await request(app).get('/api/v1/dashboard/orders-trend').set('Authorization', `Bearer ${superAdminToken}`).query({ days: 14 });
    expect(res.status).toBe(200);
    const totalAcrossDays = res.body.data.reduce((sum: number, d: { orders: number }) => sum + d.orders, 0);
    expect(totalAcrossDays).toBe(4);
  });
});
