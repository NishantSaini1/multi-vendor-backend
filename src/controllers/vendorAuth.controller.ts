import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { extractDeviceInfo } from '../utils/device';
import { ApiError } from '../utils/ApiError';
import { Vendor } from '../models/Vendor';
import * as vendorAuthService from '../services/vendorAuth.service';

export const login = catchAsync(async (req: Request, res: Response) => {
  const { identifier, password } = req.body;
  const { vendor, tokens } = await vendorAuthService.loginVendor(identifier, password, extractDeviceInfo(req));
  sendSuccess(res, { vendor, ...tokens }, 'Login successful');
});

export const refresh = catchAsync(async (req: Request, res: Response) => {
  const tokens = await vendorAuthService.refreshVendorTokens(req.body.refreshToken, extractDeviceInfo(req));
  sendSuccess(res, tokens, 'Token refreshed');
});

export const logout = catchAsync(async (req: Request, res: Response) => {
  await vendorAuthService.logoutVendor(req.body.refreshToken);
  sendSuccess(res, null, 'Logged out successfully');
});

export const logoutAll = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  await vendorAuthService.logoutAllVendorSessions(req.user.userId);
  sendSuccess(res, null, 'Logged out from all sessions');
});

export const me = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const vendor = await Vendor.findById(req.user.userId);
  if (!vendor) throw ApiError.notFound('Vendor not found');
  sendSuccess(res, vendor);
});

export const changePassword = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  await vendorAuthService.changeVendorPassword(req.user.userId, req.body.currentPassword, req.body.newPassword);
  sendSuccess(res, null, 'Password changed successfully');
});

export const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const result = await vendorAuthService.forgotVendorPassword(req.body.identifier);
  sendSuccess(res, result, 'If an account exists, a reset link has been sent');
});

export const resetPassword = catchAsync(async (req: Request, res: Response) => {
  await vendorAuthService.resetVendorPassword(req.body.resetToken, req.body.newPassword);
  sendSuccess(res, null, 'Password reset successfully');
});
