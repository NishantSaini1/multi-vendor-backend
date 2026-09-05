import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as adminUserService from '../services/adminUser.service';
import * as activityLogService from '../services/activityLog.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

function requestMeta(req: Request) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const filter: Record<string, unknown> = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.locationId) filter.locationIds = req.query.locationId;

  const { items, total } = await adminUserService.listAdminUsers(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const admin = await adminUserService.createAdminUser(req.body);
  await activityLogService.logActivity(user, {
    action: 'CREATE',
    module: 'ADMIN_USER',
    entityType: 'AdminUser',
    entityId: admin.id,
    newData: { name: admin.name, email: admin.email, role: admin.role },
    ...requestMeta(req),
  });
  sendSuccess(res, admin, 'Admin user created', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const admin = await adminUserService.getAdminUserById(req.params.id);
  sendSuccess(res, admin);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const admin = await adminUserService.updateAdminUser(req.params.id, req.body);
  await activityLogService.logActivity(user, {
    action: 'UPDATE',
    module: 'ADMIN_USER',
    entityType: 'AdminUser',
    entityId: admin.id,
    newData: req.body,
    ...requestMeta(req),
  });
  sendSuccess(res, admin, 'Admin user updated');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const admin = await adminUserService.updateAdminUserStatus(req.params.id, req.body.status, user);
  await activityLogService.logActivity(user, {
    action: 'STATUS_CHANGE',
    module: 'ADMIN_USER',
    entityType: 'AdminUser',
    entityId: admin.id,
    newData: { status: admin.status },
    ...requestMeta(req),
  });
  sendSuccess(res, admin, 'Admin user status updated');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  await adminUserService.deleteAdminUser(req.params.id, user);
  await activityLogService.logActivity(user, {
    action: 'DELETE',
    module: 'ADMIN_USER',
    entityType: 'AdminUser',
    entityId: req.params.id,
    ...requestMeta(req),
  });
  sendSuccess(res, null, 'Admin user deleted');
});

export const resetPassword = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const admin = await adminUserService.resetAdminUserPassword(req.params.id, req.body.newPassword);
  await activityLogService.logActivity(user, {
    action: 'PASSWORD_RESET',
    module: 'ADMIN_USER',
    entityType: 'AdminUser',
    entityId: admin.id,
    ...requestMeta(req),
  });
  sendSuccess(res, null, "Admin user's password has been reset");
});

export const roles = catchAsync(async (_req: Request, res: Response) => {
  sendSuccess(res, adminUserService.listRoles());
});

export const permissions = catchAsync(async (_req: Request, res: Response) => {
  sendSuccess(res, adminUserService.listPermissions());
});
