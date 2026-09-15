import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { extractDeviceInfo } from '../utils/device';
import { ApiError } from '../utils/ApiError';
import { Store } from '../models/Store';
import * as storeAuthService from '../services/storeAuth.service';

export const login = catchAsync(async (req: Request, res: Response) => {
  const { identifier, password } = req.body;
  const { store, tokens } = await storeAuthService.loginStore(identifier, password, extractDeviceInfo(req));
  sendSuccess(res, { store, ...tokens }, 'Login successful');
});

export const refresh = catchAsync(async (req: Request, res: Response) => {
  const tokens = await storeAuthService.refreshStoreTokens(req.body.refreshToken, extractDeviceInfo(req));
  sendSuccess(res, tokens, 'Token refreshed');
});

export const logout = catchAsync(async (req: Request, res: Response) => {
  await storeAuthService.logoutStore(req.body.refreshToken);
  sendSuccess(res, null, 'Logged out successfully');
});

export const logoutAll = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  await storeAuthService.logoutAllStoreSessions(req.user.userId);
  sendSuccess(res, null, 'Logged out from all sessions');
});

export const me = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const store = await Store.findById(req.user.userId);
  if (!store) throw ApiError.notFound('Store not found');
  sendSuccess(res, store);
});

export const changePassword = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  await storeAuthService.changeStorePassword(req.user.userId, req.body.currentPassword, req.body.newPassword);
  sendSuccess(res, null, 'Password changed successfully');
});

export const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const result = await storeAuthService.forgotStorePassword(req.body.identifier);
  sendSuccess(res, result, 'If an account exists, a reset link has been sent');
});

export const resetPassword = catchAsync(async (req: Request, res: Response) => {
  await storeAuthService.resetStorePassword(req.body.resetToken, req.body.newPassword);
  sendSuccess(res, null, 'Password reset successfully');
});
