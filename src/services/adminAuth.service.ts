import { AdminUser } from '../models/AdminUser';
import { ApiError } from '../utils/ApiError';
import { comparePassword, hashPassword } from '../utils/password';
import { issueTokenPair, rotateRefreshToken, revokeRefreshToken, revokeAllTokensForUser, DeviceInfo } from './token.service';
import { createResetToken, consumeResetToken } from './passwordReset.service';
import { JwtPayload } from '../utils/jwt';
import { CUSTOMER_STATUS } from '../constants/enums';

function assertAdminLoginAllowed(status: string): void {
  if (status !== CUSTOMER_STATUS.ACTIVE) {
    throw ApiError.forbidden('Your admin account has been blocked', 'ADMIN_BLOCKED');
  }
}

async function buildAdminPayload(adminId: string): Promise<JwtPayload> {
  const admin = await AdminUser.findById(adminId);
  if (!admin) throw ApiError.unauthorized('Admin not found', 'ADMIN_NOT_FOUND');
  assertAdminLoginAllowed(admin.status);
  return {
    userId: admin.id,
    userType: 'ADMIN',
    role: admin.role,
    locationIds: admin.locationIds.map((id) => id.toString()),
  };
}

export async function loginAdmin(email: string, password: string, device: DeviceInfo) {
  const admin = await AdminUser.findOne({ email: email.toLowerCase() }).select('+password');
  if (!admin) throw ApiError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');

  const isMatch = await comparePassword(password, admin.password);
  if (!isMatch) throw ApiError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');

  assertAdminLoginAllowed(admin.status);

  admin.lastLoginAt = new Date();
  await admin.save();

  const payload: JwtPayload = {
    userId: admin.id,
    userType: 'ADMIN',
    role: admin.role,
    locationIds: admin.locationIds.map((id) => id.toString()),
  };
  const tokens = await issueTokenPair(payload, device);
  return { admin, tokens };
}

export async function refreshAdminTokens(refreshToken: string, device: DeviceInfo) {
  return rotateRefreshToken(refreshToken, (userId) => buildAdminPayload(userId), device);
}

export async function logoutAdmin(refreshToken: string) {
  await revokeRefreshToken(refreshToken);
}

export async function logoutAllAdminSessions(adminId: string) {
  await revokeAllTokensForUser(adminId, 'ADMIN');
}

export async function changeAdminPassword(adminId: string, currentPassword: string, newPassword: string) {
  const admin = await AdminUser.findById(adminId).select('+password');
  if (!admin) throw ApiError.notFound('Admin not found');

  const isMatch = await comparePassword(currentPassword, admin.password);
  if (!isMatch) throw ApiError.unauthorized('Current password is incorrect', 'INVALID_CURRENT_PASSWORD');

  admin.password = await hashPassword(newPassword);
  await admin.save();
  await revokeAllTokensForUser(adminId, 'ADMIN');
}

export async function forgotAdminPassword(email: string) {
  const admin = await AdminUser.findOne({ email: email.toLowerCase() });
  if (!admin) return {};
  return createResetToken('ADMIN', admin.id, admin.email);
}

export async function resetAdminPassword(resetToken: string, newPassword: string) {
  const { userType, userId } = await consumeResetToken(resetToken);
  if (userType !== 'ADMIN') throw ApiError.badRequest('Invalid reset token', 'RESET_TOKEN_INVALID');

  const admin = await AdminUser.findById(userId);
  if (!admin) throw ApiError.notFound('Admin not found');

  admin.password = await hashPassword(newPassword);
  await admin.save();
  await revokeAllTokensForUser(userId, 'ADMIN');
}
