import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { extractDeviceInfo } from '../utils/device';
import { ApiError } from '../utils/ApiError';
import { Customer } from '../models/Customer';
import * as customerAuthService from '../services/customerAuth.service';
import * as tokenService from '../services/token.service';

export const sendOtp = catchAsync(async (req: Request, res: Response) => {
  const result = await customerAuthService.sendCustomerOtp(req.body.phone);
  sendSuccess(res, result, 'OTP sent successfully');
});

export const resendOtp = catchAsync(async (req: Request, res: Response) => {
  const result = await customerAuthService.resendCustomerOtp(req.body.phone);
  sendSuccess(res, result, 'OTP resent successfully');
});

export const verifyOtp = catchAsync(async (req: Request, res: Response) => {
  const { phone, otp } = req.body;
  const { customer, tokens } = await customerAuthService.verifyCustomerOtp(phone, otp, extractDeviceInfo(req));
  sendSuccess(res, { customer, ...tokens }, 'Login successful');
});

export const refresh = catchAsync(async (req: Request, res: Response) => {
  const tokens = await customerAuthService.refreshCustomerTokens(req.body.refreshToken, extractDeviceInfo(req));
  sendSuccess(res, tokens, 'Token refreshed');
});

export const logout = catchAsync(async (req: Request, res: Response) => {
  await customerAuthService.logoutCustomer(req.body.refreshToken);
  sendSuccess(res, null, 'Logged out successfully');
});

export const logoutAll = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  await customerAuthService.logoutAllCustomerSessions(req.user.userId);
  sendSuccess(res, null, 'Logged out from all sessions');
});

export const me = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const customer = await Customer.findById(req.user.userId);
  if (!customer) throw ApiError.notFound('Customer not found');
  sendSuccess(res, customer);
});

export const changePhone = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const customer = await customerAuthService.changeCustomerPhone(req.user.userId, req.body.newPhone, req.body.otp);
  sendSuccess(res, customer, 'Phone number updated successfully');
});

export const sessions = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const sessionList = await tokenService.listActiveSessions(req.user.userId, 'CUSTOMER');
  sendSuccess(res, sessionList);
});

export const revokeSession = catchAsync(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  await tokenService.revokeSessionById(req.user.userId, 'CUSTOMER', req.params.sessionId);
  sendSuccess(res, null, 'Session revoked');
});
