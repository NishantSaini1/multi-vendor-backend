import request from 'supertest';
import app from '../../src/app';
import { redisClient } from '../../src/config/redis';
import { AdminUser } from '../../src/models/AdminUser';
import { hashPassword } from '../../src/utils/password';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Support: config, FAQs, customer tickets and admin replies', () => {
  let customerToken: string;
  let otherCustomerToken: string;
  let supportToken: string;
  let marketingToken: string;
  let ticketId: string;

  async function customer(phone: string) {
    const send = await request(app).post('/api/v1/auth/customer/send-otp').send({ phone });
    const verify = await request(app).post('/api/v1/auth/customer/verify-otp').send({ phone, otp: send.body.data.devOtp });
    return verify.body.data.accessToken as string;
  }

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();
    const password = await hashPassword('Password123');
    await AdminUser.create({ name: 'Support', email: 'sp.support@example.com', password, role: 'SUPPORT_ADMIN', locationIds: [] });
    await AdminUser.create({ name: 'Mkt', email: 'sp.marketing@example.com', password, role: 'MARKETING_ADMIN', locationIds: [] });
    supportToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'sp.support@example.com', password: 'Password123' })).body.data.accessToken;
    marketingToken = (await request(app).post('/api/v1/auth/admin/login').send({ email: 'sp.marketing@example.com', password: 'Password123' })).body.data.accessToken;
    customerToken = await customer('9877400001');
    otherCustomerToken = await customer('9877400002');
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  it('serves default categories and contact details publicly before any are configured', async () => {
    const res = await request(app).get('/api/v1/support/config');
    expect(res.status).toBe(200);
    expect(res.body.data.categories.length).toBeGreaterThan(3);
    expect(res.body.data.categories.map((c: { key: string }) => c.key)).toContain('ACCOUNT');
    expect(res.body.data.email).toBeTruthy();
  });

  it('lets a support admin edit settings, and hides inactive categories from customers', async () => {
    const save = await request(app)
      .put('/api/v1/support/admin/config')
      .set('Authorization', `Bearer ${supportToken}`)
      .send({
        phone: '+91-9000000000',
        hours: '24x7',
        categories: [
          { key: 'ACCOUNT', label: 'Account', icon: 'person-outline', orderScoped: false, displayOrder: 1, active: true },
          { key: 'ORDER', label: 'Order', icon: 'receipt-outline', orderScoped: true, displayOrder: 2, active: true },
          { key: 'LEGACY', label: 'Old', icon: 'archive-outline', orderScoped: false, displayOrder: 3, active: false },
        ],
      });
    expect(save.status).toBe(200);

    const pub = await request(app).get('/api/v1/support/config');
    expect(pub.body.data.phone).toBe('+91-9000000000');
    expect(pub.body.data.categories.map((c: { key: string }) => c.key)).toEqual(['ACCOUNT', 'ORDER']);
  });

  it('forbids admins without support permissions from changing settings', async () => {
    const res = await request(app).put('/api/v1/support/admin/config').set('Authorization', `Bearer ${marketingToken}`).send({ hours: 'x' });
    expect(res.status).toBe(403);
  });

  it('manages FAQs and only shows ACTIVE ones publicly', async () => {
    const a = await request(app)
      .post('/api/v1/support/admin/faqs')
      .set('Authorization', `Bearer ${supportToken}`)
      .send({ question: 'How do I change my number?', answer: 'Go to Account > Edit profile.', category: 'ACCOUNT', displayOrder: 1 });
    expect(a.status).toBe(201);
    await request(app)
      .post('/api/v1/support/admin/faqs')
      .set('Authorization', `Bearer ${supportToken}`)
      .send({ question: 'Hidden one?', answer: 'Draft', status: 'INACTIVE' });

    const pub = await request(app).get('/api/v1/support/faqs');
    expect(pub.body.data.map((f: { question: string }) => f.question)).toEqual(['How do I change my number?']);
    const byCat = await request(app).get('/api/v1/support/faqs?category=ORDER');
    expect(byCat.body.data).toHaveLength(0);
  });

  it('rejects an unknown category and an order-scoped category without an order', async () => {
    const bad = await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ category: 'NOPE', message: 'Hello there support' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('SUPPORT_CATEGORY_INVALID');

    const noOrder = await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ category: 'ORDER', message: 'My order is late' });
    expect(noOrder.status).toBe(400);
    expect(noOrder.body.error.code).toBe('SUPPORT_ORDER_REQUIRED');
  });

  it('creates a ticket and lists it only for its owner', async () => {
    const res = await request(app)
      .post('/api/v1/support/tickets')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ category: 'ACCOUNT', message: 'I cannot update my email address.' });
    expect(res.status).toBe(201);
    expect(res.body.data.ticketNumber).toMatch(/^SUP/);
    expect(res.body.data.subject).toBe('Account');
    expect(res.body.data.messages).toHaveLength(1);
    ticketId = res.body.data._id;

    const mine = await request(app).get('/api/v1/support/tickets').set('Authorization', `Bearer ${customerToken}`);
    expect(mine.body.data).toHaveLength(1);
    const theirs = await request(app).get('/api/v1/support/tickets').set('Authorization', `Bearer ${otherCustomerToken}`);
    expect(theirs.body.data).toHaveLength(0);
    const peek = await request(app).get(`/api/v1/support/tickets/${ticketId}`).set('Authorization', `Bearer ${otherCustomerToken}`);
    expect(peek.status).toBe(403);
  });

  it('shows the ticket in the admin inbox, lets support reply, and flags it unread for the customer', async () => {
    const inbox = await request(app).get('/api/v1/support/admin/tickets').set('Authorization', `Bearer ${supportToken}`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.data[0].adminUnread).toBe(true);
    expect(inbox.body.meta.byStatus.OPEN).toBe(1);

    const reply = await request(app)
      .post(`/api/v1/support/admin/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${supportToken}`)
      .send({ text: 'We have updated it for you.' });
    expect(reply.status).toBe(200);
    expect(reply.body.data.status).toBe('AWAITING_CUSTOMER');

    const mine = await request(app).get('/api/v1/support/tickets').set('Authorization', `Bearer ${customerToken}`);
    expect(mine.body.meta.unread).toBe(1);
    const open = await request(app).get(`/api/v1/support/tickets/${ticketId}`).set('Authorization', `Bearer ${customerToken}`);
    expect(open.body.data.messages).toHaveLength(2);
    expect(open.body.data.customerUnread).toBe(false);
  });

  it('reopens on a customer reply, then closes with a rating', async () => {
    const reply = await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ text: 'Thanks, one more question.' });
    expect(reply.body.data.status).toBe('OPEN');

    const close = await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/close`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rating: 5 });
    expect(close.body.data.status).toBe('CLOSED');
    expect(close.body.data.rating).toBe(5);

    const after = await request(app)
      .post(`/api/v1/support/tickets/${ticketId}/messages`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ text: 'Hello?' });
    expect(after.status).toBe(422);
    expect(after.body.error.code).toBe('SUPPORT_TICKET_CLOSED');
  });
});
