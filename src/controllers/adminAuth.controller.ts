import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { extractDeviceInfo } from '../utils/device';
import { ApiError } from '../utils/ApiError';
import { AdminUser } from '../models/AdminUser';
import * as adminAuthService from '../services/adminAuth.service';

export const login = catchAsync(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const { admin, tokens } = await adminAuthService.loginAdmin(email, password, extractDeviceInfo(req));
  sendSuccess(res, { admin, ...tokens }, 'Login successful');
});

export const refresh = catchAsync(async (req: Request, res: Response) => {
  const tokens = await adminAuthService.refreshAdminTokens(req.body.refreshToken, extractDeviceInfo(req));
  sendSuccess(res, tokens, 'Token refreshed');
});

export const logout = catchAsync(async (req: Request, res: Response) => {
  await adminAuthService.logoutAdmin(req.body.refreshToken);
  sendSuccess(res, null, 'Logged out successfully');
});

export const logoutAll = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  await adminAuthService.logoutAllAdminSessions(req.user.userId);
  sendSuccess(res, null, 'Logged out from all sessions');
});

export const me = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const admin = await AdminUser.findById(req.user.userId);
  if (!admin) throw ApiError.notFound('Admin not found');
  sendSuccess(res, admin);
});

export const changePassword = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  await adminAuthService.changeAdminPassword(req.user.userId, req.body.currentPassword, req.body.newPassword);
  sendSuccess(res, null, 'Password changed successfully');
});

export const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const result = await adminAuthService.forgotAdminPassword(req.body.identifier);
  sendSuccess(res, result, 'If an account exists, a reset link has been sent');
});

export const resetPassword = catchAsync(async (req: Request, res: Response) => {
  await adminAuthService.resetAdminPassword(req.body.resetToken, req.body.newPassword);
  sendSuccess(res, null, 'Password reset successfully');
});
