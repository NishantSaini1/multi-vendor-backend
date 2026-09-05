import mongoose from 'mongoose';
import * as onesignal from '../../src/config/onesignal';
import { redisClient } from '../../src/config/redis';
import { Order } from '../../src/models/Order';
import { Notification } from '../../src/models/Notification';
import { NotificationDevice } from '../../src/models/NotificationDevice';
import { Settlement } from '../../src/models/Settlement';
import { runOrderTimeoutSweep } from '../../src/jobs/orderTimeout.job';
import { runNotificationRetry } from '../../src/jobs/notificationRetry.job';
import { runDailySettlementGeneration } from '../../src/jobs/settlementGeneration.job';
import { startTestDatabase, stopTestDatabase } from './testServer';

describe('Background jobs: order timeout sweep, notification retry, daily settlement generation', () => {
  const locationId = new mongoose.Types.ObjectId();

  function minutesAgo(minutes: number): Date {
    return new Date(Date.now() - minutes * 60 * 1000);
  }

  async function insertOrder(overrides: Record<string, unknown>) {
    const timestamp = (overrides.createdAt as Date) ?? new Date();
    return Order.create({
      orderNumber: `JOB-${new mongoose.Types.ObjectId().toString()}`,
      locationId,
      businessType: 'FOOD',
      customerId: new mongoose.Types.ObjectId(),
      vendorId: new mongoose.Types.ObjectId(),
      subtotal: 100,
      total: 100,
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      deliveryAddress: { address: 'Somewhere', pincode: '110001', latitude: 1, longitude: 1 },
      status: 'PENDING',
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    });
  }

  beforeAll(async () => {
    await startTestDatabase();
    await redisClient.flushdb();
  });

  afterAll(async () => {
    await redisClient.flushdb();
    await stopTestDatabase();
    await redisClient.quit();
  });

  describe('order timeout sweep', () => {
    it('cancels a PENDING order older than the timeout, leaving a fresh one alone', async () => {
      const stale = await insertOrder({ createdAt: minutesAgo(60), updatedAt: minutesAgo(60) });
      const fresh = await insertOrder({ createdAt: minutesAgo(1), updatedAt: minutesAgo(1) });

      const result = await runOrderTimeoutSweep();
      expect(result.cancelled).toBeGreaterThanOrEqual(1);

      const staleAfter = await Order.findById(stale.id);
      expect(staleAfter?.status).toBe('CANCELLED');
      expect(staleAfter?.cancelledBy).toBe('ADMIN');

      const freshAfter = await Order.findById(fresh.id);
      expect(freshAfter?.status).toBe('PENDING');
    });
  });

  describe('notification retry', () => {
    it('retries a FAILED notification and marks it SENT when the retried push succeeds', async () => {
      const userId = new mongoose.Types.ObjectId();
      await NotificationDevice.create({ userId, userType: 'CUSTOMER', playerId: 'player-retry-1', deviceType: 'ANDROID', deviceId: 'device-retry-1' });
      const notification = await Notification.create({
        userId,
        userType: 'CUSTOMER',
        type: 'ORDER_CREATED',
        title: 'Order placed',
        body: 'Test',
        pushStatus: 'FAILED',
        pushAttempts: 1,
      });

      (jest.spyOn(onesignal, 'sendPush') as unknown as jest.Mock).mockResolvedValueOnce('sent');

      const result = await runNotificationRetry();
      expect(result.retried).toBeGreaterThanOrEqual(1);
      expect(result.succeeded).toBeGreaterThanOrEqual(1);

      const after = await Notification.findById(notification.id);
      expect(after?.pushStatus).toBe('SENT');
      expect(after?.pushAttempts).toBe(2);
    });

    it('marks a FAILED notification SKIPPED once its user has no registered devices', async () => {
      const userId = new mongoose.Types.ObjectId();
      const notification = await Notification.create({
        userId,
        userType: 'CUSTOMER',
        type: 'ORDER_CREATED',
        title: 'No devices',
        body: 'Test',
        pushStatus: 'FAILED',
        pushAttempts: 1,
      });

      await runNotificationRetry();

      const after = await Notification.findById(notification.id);
      expect(after?.pushStatus).toBe('SKIPPED');
    });

    it('does not retry a notification that has already exhausted its attempts', async () => {
      const userId = new mongoose.Types.ObjectId();
      await NotificationDevice.create({ userId, userType: 'CUSTOMER', playerId: 'player-retry-2', deviceType: 'ANDROID', deviceId: 'device-retry-2' });
      const notification = await Notification.create({
        userId,
        userType: 'CUSTOMER',
        type: 'ORDER_CREATED',
        title: 'Exhausted',
        body: 'Test',
        pushStatus: 'FAILED',
        pushAttempts: 3, // == NOTIFICATION_RETRY_MAX_ATTEMPTS default
      });

      await runNotificationRetry();

      const after = await Notification.findById(notification.id);
      expect(after?.pushAttempts).toBe(3);
      expect(after?.pushStatus).toBe('FAILED');
    });
  });

  describe('daily settlement generation', () => {
    it("generates yesterday's VENDOR and DELIVERY_PARTNER settlements from a DELIVERED order", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(12, 0, 0, 0);

      const deliveryPartnerId = new mongoose.Types.ObjectId();
      const order = await insertOrder({
        status: 'DELIVERED',
        deliveryPartnerId,
        subtotal: 500,
        total: 520,
        deliveryFee: 20,
        createdAt: yesterday,
        updatedAt: yesterday,
      });

      await runDailySettlementGeneration();

      const vendorSettlement = await Settlement.findOne({ payeeType: 'VENDOR', orderIds: order._id });
      expect(vendorSettlement).not.toBeNull();
      expect(vendorSettlement?.grossAmount).toBe(500);

      const partnerSettlement = await Settlement.findOne({ payeeType: 'DELIVERY_PARTNER', orderIds: order._id });
      expect(partnerSettlement).not.toBeNull();
      expect(partnerSettlement?.grossAmount).toBe(20);
    });
  });
});
