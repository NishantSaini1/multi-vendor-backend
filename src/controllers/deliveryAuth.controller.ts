import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { extractDeviceInfo } from '../utils/device';
import { ApiError } from '../utils/ApiError';
import { DeliveryPartner } from '../models/DeliveryPartner';
import * as deliveryAuthService from '../services/deliveryAuth.service';

export const login = catchAsync(async (req: Request, res: Response) => {
  const { phone, password } = req.body;
  const { partner, tokens } = await deliveryAuthService.loginDeliveryPartner(phone, password, extractDeviceInfo(req));
  sendSuccess(res, { partner, ...tokens }, 'Login successful');
});

export const refresh = catchAsync(async (req: Request, res: Response) => {
  const tokens = await deliveryAuthService.refreshDeliveryTokens(req.body.refreshToken, extractDeviceInfo(req));
  sendSuccess(res, tokens, 'Token refreshed');
});

export const logout = catchAsync(async (req: Request, res: Response) => {
  await deliveryAuthService.logoutDeliveryPartner(req.body.refreshToken);
  sendSuccess(res, null, 'Logged out successfully');
});

export const logoutAll = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  await deliveryAuthService.logoutAllDeliveryPartnerSessions(req.user.userId);
  sendSuccess(res, null, 'Logged out from all sessions');
});

export const me = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const partner = await DeliveryPartner.findById(req.user.userId);
  if (!partner) throw ApiError.notFound('Delivery partner not found');
  sendSuccess(res, partner);
});

export const changePassword = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  await deliveryAuthService.changeDeliveryPartnerPassword(req.user.userId, req.body.currentPassword, req.body.newPassword);
  sendSuccess(res, null, 'Password changed successfully');
});

export const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const result = await deliveryAuthService.forgotDeliveryPartnerPassword(req.body.identifier);
  sendSuccess(res, result, 'If an account exists, a reset token has been sent');
});

export const resetPassword = catchAsync(async (req: Request, res: Response) => {
  await deliveryAuthService.resetDeliveryPartnerPassword(req.body.resetToken, req.body.newPassword);
  sendSuccess(res, null, 'Password reset successfully');
});
