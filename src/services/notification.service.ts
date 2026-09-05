import { Notification, NOTIFICATION_PUSH_STATUS } from '../models/Notification';
import { NotificationDevice } from '../models/NotificationDevice';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { UserType } from '../constants/roles';
import { sendPush, SendPushResult } from '../config/onesignal';
import { logger } from '../utils/logger';

export async function registerDevice(user: JwtPayload, data: { playerId: string; deviceType: string; deviceId: string }) {
  // Upsert on (userId, deviceId): re-registering the same physical device
  // (app reinstall, token refresh) updates its OneSignal playerId in place
  // rather than accumulating duplicate rows — the model's unique index on
  // (userId, deviceId) backstops this.
  return NotificationDevice.findOneAndUpdate(
    { userId: user.userId, deviceId: data.deviceId },
    { userId: user.userId, userType: user.userType, playerId: data.playerId, deviceType: data.deviceType, deviceId: data.deviceId },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function unregisterDevice(id: string, user: JwtPayload) {
  const device = await NotificationDevice.findById(id);
  if (!device) throw ApiError.notFound('Device registration not found', 'DEVICE_NOT_FOUND');
  if (device.userId.toString() !== user.userId) {
    throw ApiError.forbidden('You do not have access to this device registration', 'DEVICE_FORBIDDEN');
  }
  await device.deleteOne();
}

export function notificationListFilter(user: JwtPayload, isRead?: string): Record<string, unknown> {
  const filter: Record<string, unknown> = { userId: user.userId, userType: user.userType };
  if (isRead !== undefined) filter.isRead = isRead === 'true';
  return filter;
}

export async function listNotifications(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Notification.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Notification.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getUnreadCount(user: JwtPayload) {
  return Notification.countDocuments({ userId: user.userId, userType: user.userType, isRead: false });
}

async function findOwnNotificationOrThrow(id: string, user: JwtPayload) {
  const notification = await Notification.findById(id);
  if (!notification) throw ApiError.notFound('Notification not found', 'NOTIFICATION_NOT_FOUND');
  if (notification.userId.toString() !== user.userId || notification.userType !== user.userType) {
    throw ApiError.forbidden('You do not have access to this notification', 'NOTIFICATION_FORBIDDEN');
  }
  return notification;
}

export async function markRead(id: string, user: JwtPayload) {
  const notification = await findOwnNotificationOrThrow(id, user);
  if (!notification.isRead) {
    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();
  }
  return notification;
}

export async function markAllRead(user: JwtPayload) {
  await Notification.updateMany(
    { userId: user.userId, userType: user.userType, isRead: false },
    { isRead: true, readAt: new Date() },
  );
}

export async function deleteNotification(id: string, user: JwtPayload) {
  const notification = await findOwnNotificationOrThrow(id, user);
  await notification.deleteOne();
}

function stringifyData(data: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return result;
}

// 'skipped' means nothing was attempted (unconfigured, or no devices) —
// leave the record's status as-is (SKIPPED by default) rather than
// recording a spurious attempt the retry job would otherwise pick up.
async function applyPushResult(notification: InstanceType<typeof Notification>, result: SendPushResult): Promise<void> {
  if (result === 'skipped') return;
  notification.pushStatus = result === 'sent' ? NOTIFICATION_PUSH_STATUS.SENT : NOTIFICATION_PUSH_STATUS.FAILED;
  notification.pushAttempts += 1;
  await notification.save();
}

// The core send primitive every other service (order/delivery/payment/
// refund/settlement) calls to notify a user of something that happened.
// Always writes the in-app Notification record first — that's the durable
// source of truth and must succeed even when OneSignal is unreachable or
// unconfigured — then best-effort pushes to every device the user has
// registered. Never throws: this is meant to be called as a fire-and-forget
// side effect *after* the triggering operation's own work (and, where
// relevant, its DB transaction) has already completed, so a notification
// failure must never look like the triggering operation itself failed. A
// FAILED push is picked up later by the notification-retry background job
// (jobs/notificationRetry.job.ts), not retried inline here.
export async function notify(
  userId: string,
  userType: UserType,
  type: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  let notification: InstanceType<typeof Notification> | undefined;
  try {
    notification = await Notification.create({ userId, userType, type, title, body, data });
  } catch (err) {
    logger.error({ err, userId, userType, type }, 'Failed to create in-app notification record');
    return;
  }

  const devices = await NotificationDevice.find({ userId, userType }).catch(() => []);
  if (devices.length === 0) return;

  const result = await sendPush({
    playerIds: devices.map((d) => d.playerId),
    title,
    body,
    data: data ? stringifyData(data) : undefined,
  });
  await applyPushResult(notification, result);
}

// Re-attempts push delivery for recent FAILED notifications that haven't
// exceeded the retry limit — called from the notification-retry background
// job. Bounded by age (`olderThanHours`) so a permanently unreachable
// OneSignal, or a user who never registers a working device, doesn't leave
// an ever-growing backlog retried forever.
export async function retryFailedPushes(maxAttempts: number, olderThanHours = 24): Promise<{ retried: number; succeeded: number }> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const candidates = await Notification.find({
    pushStatus: NOTIFICATION_PUSH_STATUS.FAILED,
    pushAttempts: { $lt: maxAttempts },
    createdAt: { $gte: cutoff },
  });

  let succeeded = 0;
  for (const notification of candidates) {
    const devices = await NotificationDevice.find({ userId: notification.userId, userType: notification.userType }).catch(() => []);
    if (devices.length === 0) {
      notification.pushStatus = NOTIFICATION_PUSH_STATUS.SKIPPED;
      await notification.save();
      continue;
    }

    const result = await sendPush({
      playerIds: devices.map((d) => d.playerId),
      title: notification.title,
      body: notification.body,
      data: notification.data ? stringifyData(notification.data) : undefined,
    });
    await applyPushResult(notification, result);
    if (result === 'sent') succeeded += 1;
  }

  return { retried: candidates.length, succeeded };
}
