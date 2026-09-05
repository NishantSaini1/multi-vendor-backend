import { Vendor } from '../models/Vendor';
import { ApiError } from '../utils/ApiError';
import { comparePassword, hashPassword } from '../utils/password';
import { issueTokenPair, rotateRefreshToken, revokeRefreshToken, revokeAllTokensForUser, DeviceInfo } from './token.service';
import { createResetToken, consumeResetToken } from './passwordReset.service';
import { JwtPayload } from '../utils/jwt';
import { VENDOR_STATUS } from '../constants/enums';

async function buildVendorPayload(vendorId: string): Promise<JwtPayload> {
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) throw ApiError.unauthorized('Vendor not found', 'VENDOR_NOT_FOUND');
  assertVendorLoginAllowed(vendor.status);
  return { userId: vendor.id, userType: 'VENDOR', role: 'VENDOR', locationIds: [vendor.locationId.toString()] };
}

function assertVendorLoginAllowed(status: string): void {
  if (status !== VENDOR_STATUS.ACTIVE) {
    throw ApiError.forbidden('Your vendor account is not active', 'VENDOR_NOT_ACTIVE');
  }
}

export async function loginVendor(identifier: string, password: string, device: DeviceInfo) {
  const isEmail = identifier.includes('@');
  const vendor = await Vendor.findOne(isEmail ? { email: identifier.toLowerCase() } : { phone: identifier }).select(
    '+password',
  );

  if (!vendor) throw ApiError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');

  const isMatch = await comparePassword(password, vendor.password);
  if (!isMatch) throw ApiError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');

  assertVendorLoginAllowed(vendor.status);

  const payload: JwtPayload = { userId: vendor.id, userType: 'VENDOR', role: 'VENDOR', locationIds: [vendor.locationId.toString()] };
  const tokens = await issueTokenPair(payload, device);
  return { vendor, tokens };
}

export async function refreshVendorTokens(refreshToken: string, device: DeviceInfo) {
  return rotateRefreshToken(refreshToken, (userId) => buildVendorPayload(userId), device);
}

export async function logoutVendor(refreshToken: string) {
  await revokeRefreshToken(refreshToken);
}

export async function logoutAllVendorSessions(vendorId: string) {
  await revokeAllTokensForUser(vendorId, 'VENDOR');
}

export async function changeVendorPassword(vendorId: string, currentPassword: string, newPassword: string) {
  const vendor = await Vendor.findById(vendorId).select('+password');
  if (!vendor) throw ApiError.notFound('Vendor not found');

  const isMatch = await comparePassword(currentPassword, vendor.password);
  if (!isMatch) throw ApiError.unauthorized('Current password is incorrect', 'INVALID_CURRENT_PASSWORD');

  vendor.password = await hashPassword(newPassword);
  await vendor.save();
  await revokeAllTokensForUser(vendorId, 'VENDOR');
}

export async function forgotVendorPassword(identifier: string) {
  const isEmail = identifier.includes('@');
  const vendor = await Vendor.findOne(isEmail ? { email: identifier.toLowerCase() } : { phone: identifier });
  if (!vendor) {
    // Do not reveal whether the account exists.
    return {};
  }
  return createResetToken('VENDOR', vendor.id, vendor.email);
}

export async function resetVendorPassword(resetToken: string, newPassword: string) {
  const { userType, userId } = await consumeResetToken(resetToken);
  if (userType !== 'VENDOR') throw ApiError.badRequest('Invalid reset token', 'RESET_TOKEN_INVALID');

  const vendor = await Vendor.findById(userId);
  if (!vendor) throw ApiError.notFound('Vendor not found');

  vendor.password = await hashPassword(newPassword);
  await vendor.save();
  await revokeAllTokensForUser(userId, 'VENDOR');
}
