import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as notificationService from '../services/notification.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const registerDevice = catchAsync(async (req: Request, res: Response) => {
  const device = await notificationService.registerDevice(requireUser(req), req.body);
  sendSuccess(res, device, 'Device registered', 201);
});

export const unregisterDevice = catchAsync(async (req: Request, res: Response) => {
  await notificationService.unregisterDevice(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Device unregistered');
});

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req);
  const filter = notificationService.notificationListFilter(user, req.query.isRead as string | undefined);
  const { items, total } = await notificationService.listNotifications(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const unreadCount = catchAsync(async (req: Request, res: Response) => {
  const count = await notificationService.getUnreadCount(requireUser(req));
  sendSuccess(res, { count });
});

export const markRead = catchAsync(async (req: Request, res: Response) => {
  const notification = await notificationService.markRead(req.params.id, requireUser(req));
  sendSuccess(res, notification, 'Notification marked as read');
});

export const markAllRead = catchAsync(async (req: Request, res: Response) => {
  await notificationService.markAllRead(requireUser(req));
  sendSuccess(res, null, 'All notifications marked as read');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await notificationService.deleteNotification(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Notification deleted');
});
