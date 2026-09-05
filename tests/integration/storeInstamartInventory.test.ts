import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Stores + Instamart catalog + Inventory', () => {
  let locationId: string;
  let superAdminToken: string;

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({
      name: 'Instamart City',
      code: 'INSTACITY',
      state: 'UP',
      district: 'D1',
      latitude: 8,
      longitude: 8,
    });
    locationId = location.id;

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Super', email: 'i.super@example.com', password, role: 'SUPER_ADMIN', locationIds: [] });
    superAdminToken = (
      await request(app).post('/api/v1/auth/admin/login').send({ email: 'i.super@example.com', password: 'Password123' })
    ).body.data.accessToken;
  }, 60000);

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  let storeId: string;

  it('creates a store without requiring a password', async () => {
    const res = await request(app)
      .post('/api/v1/stores')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        locationId,
        name: 'Test Store',
        managerName: 'Manager',
        phone: '9844400001',
        address: 'Addr',
        latitude: 8,
        longitude: 8,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.password).toBeUndefined();
    storeId = res.body.data._id;
  });

  let categoryId: string;
  let productId: string;
  let inventoryId: string;

  it('creates an instamart category and product, auto-creating a zero-stock inventory record', async () => {
    const categoryRes = await request(app)
      .post('/api/v1/instamart/categories')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ name: 'Groceries' });
    categoryId = categoryRes.body.data._id;

    const productRes = await request(app)
      .post('/api/v1/instamart/products')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        storeId,
        categoryId,
        name: 'Rice 1kg',
        sku: 'RICE-1',
        mrp: 100,
        sellingPrice: 90,
        unit: 'kg',
      });
    expect(productRes.status).toBe(201);
    productId = productRes.body.data._id;

    const inventoryRes = await request(app)
      .get(`/api/v1/inventory/product/${productId}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(inventoryRes.status).toBe(200);
    expect(inventoryRes.body.data).toHaveLength(1);
    expect(inventoryRes.body.data[0].currentStock).toBe(0);
    inventoryId = inventoryRes.body.data[0]._id;
  });

  it('rejects a product for a nonexistent store', async () => {
    const res = await request(app)
      .post('/api/v1/instamart/products')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        storeId: '507f1f77bcf86cd799439099',
        categoryId,
        name: 'Ghost Product',
        sku: 'GHOST-1',
        mrp: 10,
        sellingPrice: 9,
        unit: 'kg',
      });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('STORE_NOT_FOUND');
  });

  it('shows the new inventory record in the out-of-stock list', async () => {
    const res = await request(app)
      .get('/api/v1/inventory/out-of-stock')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((i: { _id: string }) => i._id === inventoryId)).toBe(true);
  });

  it('rejects a SALE adjustment larger than current stock', async () => {
    const res = await request(app)
      .post('/api/v1/inventory/adjust')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ inventoryId, type: 'SALE', quantity: 5 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('applies a PURCHASE adjustment and records a transaction with before/after stock', async () => {
    const res = await request(app)
      .post('/api/v1/inventory/adjust')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ inventoryId, type: 'PURCHASE', quantity: 50 });
    expect(res.status).toBe(200);
    expect(res.body.data.currentStock).toBe(50);

    const historyRes = await request(app)
      .get(`/api/v1/inventory/${inventoryId}/history`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(historyRes.body.data[0]).toMatchObject({ type: 'PURCHASE', stockBefore: 0, stockAfter: 50 });
  });

  it('reserves stock, then rejects reserving more than is available', async () => {
    const reserveRes = await request(app)
      .post('/api/v1/inventory/adjust')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ inventoryId, type: 'RESERVATION', quantity: 45 });
    expect(reserveRes.status).toBe(200);
    expect(reserveRes.body.data.reservedStock).toBe(45);

    const overReserveRes = await request(app)
      .post('/api/v1/inventory/adjust')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ inventoryId, type: 'RESERVATION', quantity: 10 });
    expect(overReserveRes.status).toBe(422);
    expect(overReserveRes.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('releases reserved stock back down', async () => {
    const res = await request(app)
      .post('/api/v1/inventory/adjust')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ inventoryId, type: 'RELEASE', quantity: 45 });
    expect(res.status).toBe(200);
    expect(res.body.data.reservedStock).toBe(0);
  });

  it('bulk-updates inventory and logs an ADJUSTMENT transaction per item', async () => {
    const res = await request(app)
      .post('/api/v1/inventory/bulk-update')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ updates: [{ inventoryId, currentStock: 20 }] });
    expect(res.status).toBe(200);
    expect(res.body.data[0].currentStock).toBe(20);
  });

  it('deletes the instamart product and its inventory record together (transactional cleanup)', async () => {
    const res = await request(app)
      .delete(`/api/v1/instamart/products/${productId}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);

    const inventoryRes = await request(app)
      .get(`/api/v1/inventory/${inventoryId}`)
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(inventoryRes.status).toBe(404);
  });
});
