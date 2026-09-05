import { Customer } from '../models/Customer';
import { ApiError } from '../utils/ApiError';
import { sendOtp as sendOtpChallenge, verifyOtp as verifyOtpChallenge } from './otp.service';
import { issueTokenPair, rotateRefreshToken, revokeRefreshToken, revokeAllTokensForUser, DeviceInfo } from './token.service';
import { JwtPayload } from '../utils/jwt';
import { CUSTOMER_STATUS } from '../constants/enums';

async function buildCustomerPayload(customerId: string): Promise<JwtPayload> {
  const customer = await Customer.findById(customerId);
  if (!customer) throw ApiError.unauthorized('Customer not found', 'CUSTOMER_NOT_FOUND');
  if (customer.status === CUSTOMER_STATUS.BLOCKED) {
    throw ApiError.forbidden('Your account has been blocked', 'CUSTOMER_BLOCKED');
  }
  return { userId: customer.id, userType: 'CUSTOMER', role: 'CUSTOMER', locationIds: [] };
}

export async function sendCustomerOtp(phone: string) {
  return sendOtpChallenge(phone);
}

export async function resendCustomerOtp(phone: string) {
  return sendOtpChallenge(phone);
}

export async function verifyCustomerOtp(phone: string, otp: string, device: DeviceInfo) {
  await verifyOtpChallenge(phone, otp);

  let customer = await Customer.findOne({ phone });
  if (!customer) {
    customer = await Customer.create({ phone, lastLoginAt: new Date() });
  } else {
    customer.lastLoginAt = new Date();
    await customer.save();
  }

  if (customer.status === CUSTOMER_STATUS.BLOCKED) {
    throw ApiError.forbidden('Your account has been blocked', 'CUSTOMER_BLOCKED');
  }

  const payload: JwtPayload = { userId: customer.id, userType: 'CUSTOMER', role: 'CUSTOMER', locationIds: [] };
  const tokens = await issueTokenPair(payload, device);
  return { customer, tokens };
}

export async function refreshCustomerTokens(refreshToken: string, device: DeviceInfo) {
  return rotateRefreshToken(refreshToken, (userId) => buildCustomerPayload(userId), device);
}

export async function logoutCustomer(refreshToken: string) {
  await revokeRefreshToken(refreshToken);
}

export async function logoutAllCustomerSessions(customerId: string) {
  await revokeAllTokensForUser(customerId, 'CUSTOMER');
}

export async function changeCustomerPhone(customerId: string, newPhone: string, otp: string) {
  await verifyOtpChallenge(newPhone, otp);

  const existing = await Customer.findOne({ phone: newPhone });
  if (existing && existing.id !== customerId) {
    throw ApiError.conflict('Phone number already in use', 'PHONE_ALREADY_IN_USE');
  }

  const customer = await Customer.findByIdAndUpdate(customerId, { phone: newPhone }, { new: true });
  if (!customer) throw ApiError.notFound('Customer not found');
  return customer;
}
