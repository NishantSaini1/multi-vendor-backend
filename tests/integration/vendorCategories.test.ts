import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { Location } from '../../src/models/Location';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';
import { createTestVendor, createGlobalFoodItem } from './helpers/foodFixtures';

// Vendor-owned categories/subcategories (see FoodCategory.ts): a vendor can
// create and manage its own, use them without a catalog-access grant, and
// read — but never change — the global, admin-managed ones. Other vendors
// never see them.
describe('Vendor-owned food categories and subcategories', () => {
  let superAdminToken: string;
  let vendorAToken: string;
  let vendorBToken: string;
  let customerToken: string;
  let vendorAId: string;
  let globalCategoryId: string;
  let globalSubcategoryId: string;

  const api = (token: string) => ({
    get: (url: string) => request(app).get(`/api/v1${url}`).set('Authorization', `Bearer ${token}`),
    post: (url: string, body: object) => request(app).post(`/api/v1${url}`).set('Authorization', `Bearer ${token}`).send(body),
    patch: (url: string, body: object) => request(app).patch(`/api/v1${url}`).set('Authorization', `Bearer ${token}`).send(body),
    delete: (url: string) => request(app).delete(`/api/v1${url}`).set('Authorization', `Bearer ${token}`),
  });

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();

    const location = await Location.create({ name: 'Cat City', code: 'CATCITY', state: 'UP', district: 'D1', latitude: 7, longitude: 7 });

    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Super', email: 'vc.super@example.com', password, role: 'SUPER_ADMIN', locationIds: [] });
    superAdminToken = (
      await request(app).post('/api/v1/auth/admin/login').send({ email: 'vc.super@example.com', password: 'Password123' })
    ).body.data.accessToken;

    const vendorPassword = await hashPassword('VendorPass123');
    const base = { locationId: location.id, ownerName: 'Owner', password: vendorPassword, address: 'Addr', latitude: 7, longitude: 7, status: 'ACTIVE' };
    const vendorA = await createTestVendor({ ...base, restaurantName: 'Vendor A', phone: '9844400001' });
    await createTestVendor({ ...base, restaurantName: 'Vendor B', phone: '9844400002' });
    vendorAId = vendorA.id;

    const vendorLogin = async (phone: string) =>
      (await request(app).post('/api/v1/auth/vendor/login').send({ identifier: phone, password: 'VendorPass123' })).body.data.accessToken;
    vendorAToken = await vendorLogin('9844400001');
    vendorBToken = await vendorLogin('9844400002');

    const sendOtp = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone: '9844400050' });
    customerToken = (
      await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone: '9844400050', otp: sendOtp.body.data.devOtp })
    ).body.data.accessToken;

    globalCategoryId = (await api(superAdminToken).post('/food/categories', { name: 'Biryani' })).body.data._id;
    globalSubcategoryId = (await api(superAdminToken).post('/food/subcategories', { name: 'Veg Biryani', categoryId: globalCategoryId }))
      .body.data._id;
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  let ownCategoryId: string;
  let ownSubcategoryId: string;
  let pendingSubmissionId: string;

  it('keeps an admin-created category global', async () => {
    const res = await api(superAdminToken).get(`/food/categories/${globalCategoryId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.vendorId).toBeNull();
  });

  it('lets a vendor create its own category, owned by it with a server-derived slug', async () => {
    const res = await api(vendorAToken).post('/food/categories', { name: 'House Specials', slug: 'hijack', vendorId: 'x' });
    expect(res.status).toBe(201);
    expect(res.body.data.vendorId).toBe(vendorAId);
    expect(res.body.data.slug).toBe(`house-specials-${vendorAId.slice(-6)}`);
    ownCategoryId = res.body.data._id;
  });

  it('lets two vendors each have a category with the same name', async () => {
    const res = await api(vendorBToken).post('/food/categories', { name: 'House Specials' });
    expect(res.status).toBe(201);
  });

  it("rejects a vendor category that duplicates a global one's name, or one it already owns", async () => {
    const global = await api(vendorAToken).post('/food/categories', { name: 'biryani' });
    expect(global.status).toBe(409);
    expect(global.body.error.code).toBe('CATEGORY_NAME_EXISTS_GLOBALLY');

    const own = await api(vendorAToken).post('/food/categories', { name: 'House specials' });
    expect(own.status).toBe(409);
    expect(own.body.error.code).toBe('CATEGORY_NAME_EXISTS');
  });

  it('lists global categories plus only the vendor’s own ones', async () => {
    const res = await api(vendorAToken).get('/food/categories');
    expect(res.status).toBe(200);
    const owners = res.body.data.map((c: { vendorId: string | null }) => c.vendorId);
    expect(res.body.data.map((c: { _id: string }) => c._id)).toEqual(expect.arrayContaining([globalCategoryId, ownCategoryId]));
    expect(owners.every((o: string | null) => o === null || o === vendorAId)).toBe(true);
  });

  it("hides one vendor's category from another vendor entirely", async () => {
    expect((await api(vendorBToken).get(`/food/categories/${ownCategoryId}`)).status).toBe(404);
    expect((await api(vendorBToken).patch(`/food/categories/${ownCategoryId}`, { name: 'Stolen' })).status).toBe(404);
    expect((await api(vendorBToken).delete(`/food/categories/${ownCategoryId}`)).status).toBe(404);
  });

  it('never lets a vendor change or delete a global category', async () => {
    const update = await api(vendorAToken).patch(`/food/categories/${globalCategoryId}`, { name: 'Renamed' });
    expect(update.status).toBe(403);
    expect(update.body.error.code).toBe('GLOBAL_CATEGORY_READ_ONLY');
    expect((await api(vendorAToken).patch(`/food/categories/${globalCategoryId}/status`, { status: 'INACTIVE' })).status).toBe(403);
    expect((await api(vendorAToken).delete(`/food/categories/${globalCategoryId}`)).status).toBe(403);
  });

  it('lets a vendor edit and switch off its own category, and still see it while inactive', async () => {
    const update = await api(vendorAToken).patch(`/food/categories/${ownCategoryId}`, { name: "Chef's Specials", description: 'Ours' });
    expect(update.status).toBe(200);
    expect(update.body.data.name).toBe("Chef's Specials");

    expect((await api(vendorAToken).patch(`/food/categories/${ownCategoryId}/status`, { status: 'INACTIVE' })).status).toBe(200);
    const list = await api(vendorAToken).get('/food/categories');
    expect(list.body.data.map((c: { _id: string }) => c._id)).toContain(ownCategoryId);
    expect((await api(vendorAToken).patch(`/food/categories/${ownCategoryId}/status`, { status: 'ACTIVE' })).status).toBe(200);
  });

  it("shows a customer a vendor's own categories only when browsing that vendor", async () => {
    const plain = await api(customerToken).get('/food/categories');
    expect(plain.body.data.map((c: { _id: string }) => c._id)).not.toContain(ownCategoryId);

    const browsing = await api(customerToken).get(`/food/categories?vendorId=${vendorAId}`);
    expect(browsing.body.data.map((c: { _id: string }) => c._id)).toEqual(expect.arrayContaining([globalCategoryId, ownCategoryId]));
  });

  it('lets a vendor add its own subcategory under its own category and under a global one', async () => {
    const underOwn = await api(vendorAToken).post('/food/subcategories', { name: 'Signature Rolls', categoryId: ownCategoryId });
    expect(underOwn.status).toBe(201);
    expect(underOwn.body.data.vendorId).toBe(vendorAId);
    ownSubcategoryId = underOwn.body.data._id;

    const underGlobal = await api(vendorAToken).post('/food/subcategories', { name: 'Hyderabadi Dum', categoryId: globalCategoryId });
    expect(underGlobal.status).toBe(201);
    expect(underGlobal.body.data.vendorId).toBe(vendorAId);

    const listB = await api(vendorBToken).get(`/food/subcategories?categoryId=${globalCategoryId}`);
    expect(listB.body.data.map((s: { name: string }) => s.name)).toEqual(['Veg Biryani']);
  });

  it("rejects a subcategory under another vendor's category, or duplicating a global subcategory's name", async () => {
    const res = await api(vendorBToken).post('/food/subcategories', { name: 'Sneaky', categoryId: ownCategoryId });
    expect(res.status).toBe(404);

    const dup = await api(vendorAToken).post('/food/subcategories', { name: 'veg biryani', categoryId: globalCategoryId });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SUBCATEGORY_NAME_EXISTS_GLOBALLY');
  });

  it('never lets a vendor change a global subcategory', async () => {
    const res = await api(vendorAToken).patch(`/food/subcategories/${globalSubcategoryId}`, { name: 'Renamed' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GLOBAL_SUBCATEGORY_READ_ONLY');
  });

  it('lets a vendor submit a new item under its own category without any catalog-access grant', async () => {
    const own = await api(vendorAToken).post('/food-item-submissions', {
      name: 'Paneer Tikka Roll',
      categoryId: ownCategoryId,
      subcategoryId: ownSubcategoryId,
      price: 150,
    });
    expect(own.status).toBe(201);
    pendingSubmissionId = own.body.data._id;

    const noGrant = await api(vendorAToken).post('/food-item-submissions', { name: 'Plain Biryani', categoryId: globalCategoryId, price: 120 });
    expect(noGrant.status).toBe(403);

    const others = await api(vendorBToken).post('/food-item-submissions', { name: 'Copycat', categoryId: ownCategoryId, price: 99 });
    expect(others.status).toBe(403);
  });

  it("keeps items filed under a vendor's private category out of other vendors' catalog browse", async () => {
    const item = await createGlobalFoodItem(ownCategoryId, { name: 'Private Roll' });
    const listB = await api(vendorBToken).get('/food-items');
    expect(listB.body.data.map((p: { _id: string }) => p._id)).not.toContain(item.id);
    expect((await api(vendorBToken).get(`/food-items/${item.id}`)).status).toBe(404);

    const listA = await api(vendorAToken).get(`/food-items?categoryId=${ownCategoryId}`);
    expect(listA.body.data.map((p: { _id: string }) => p._id)).toContain(item.id);
    await item.deleteOne();
  });

  it('refuses to delete a vendor category/subcategory still in use, then allows it once empty', async () => {
    const blocked = await api(vendorAToken).delete(`/food/categories/${ownCategoryId}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('CATEGORY_IN_USE');

    // The pending submission filed under the subcategory blocks it too.
    const subBlocked = await api(vendorAToken).delete(`/food/subcategories/${ownSubcategoryId}`);
    expect(subBlocked.status).toBe(409);
    expect(subBlocked.body.error.code).toBe('SUBCATEGORY_IN_USE');

    const rejected = await api(superAdminToken).post(`/food-item-submissions/${pendingSubmissionId}/reject`, { rejectionReason: 'Test cleanup' });
    expect(rejected.status).toBe(200);

    expect((await api(vendorAToken).delete(`/food/subcategories/${ownSubcategoryId}`)).status).toBe(200);
    expect((await api(vendorAToken).delete(`/food/categories/${ownCategoryId}`)).status).toBe(200);
  });

  it('refuses a catalog-access grant for a private category', async () => {
    const privateCategory = (await api(vendorAToken).post('/food/categories', { name: 'Secret Menu' })).body.data._id;
    const res = await api(superAdminToken).post(`/vendors/${vendorAId}/catalog-access`, { categoryId: privateCategory });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CATALOG_ACCESS_PRIVATE_CATEGORY');
  });
});
