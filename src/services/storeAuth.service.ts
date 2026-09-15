import { Store } from '../models/Store';
import { ApiError } from '../utils/ApiError';
import { comparePassword, hashPassword } from '../utils/password';
import { issueTokenPair, rotateRefreshToken, revokeRefreshToken, revokeAllTokensForUser, DeviceInfo } from './token.service';
import { createResetToken, consumeResetToken } from './passwordReset.service';
import { JwtPayload } from '../utils/jwt';
import { STORE_STATUS } from '../constants/enums';

async function buildStorePayload(storeId: string): Promise<JwtPayload> {
  const store = await Store.findById(storeId);
  if (!store) throw ApiError.unauthorized('Store not found', 'STORE_NOT_FOUND');
  assertStoreLoginAllowed(store.status);
  return { userId: store.id, userType: 'STORE', role: 'STORE', locationIds: [store.locationId.toString()] };
}

function assertStoreLoginAllowed(status: string): void {
  if (status !== STORE_STATUS.ACTIVE) {
    throw ApiError.forbidden('Your store account is not active', 'STORE_NOT_ACTIVE');
  }
}

export async function loginStore(identifier: string, password: string, device: DeviceInfo) {
  const isEmail = identifier.includes('@');
  const store = await Store.findOne(isEmail ? { email: identifier.toLowerCase() } : { phone: identifier }).select(
    '+password',
  );

  if (!store) throw ApiError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');

  const isMatch = await comparePassword(password, store.password);
  if (!isMatch) throw ApiError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');

  assertStoreLoginAllowed(store.status);

  const payload: JwtPayload = { userId: store.id, userType: 'STORE', role: 'STORE', locationIds: [store.locationId.toString()] };
  const tokens = await issueTokenPair(payload, device);
  return { store, tokens };
}

export async function refreshStoreTokens(refreshToken: string, device: DeviceInfo) {
  return rotateRefreshToken(refreshToken, (userId) => buildStorePayload(userId), device);
}

export async function logoutStore(refreshToken: string) {
  await revokeRefreshToken(refreshToken);
}

export async function logoutAllStoreSessions(storeId: string) {
  await revokeAllTokensForUser(storeId, 'STORE');
}

export async function changeStorePassword(storeId: string, currentPassword: string, newPassword: string) {
  const store = await Store.findById(storeId).select('+password');
  if (!store) throw ApiError.notFound('Store not found');

  const isMatch = await comparePassword(currentPassword, store.password);
  if (!isMatch) throw ApiError.unauthorized('Current password is incorrect', 'INVALID_CURRENT_PASSWORD');

  store.password = await hashPassword(newPassword);
  await store.save();
  await revokeAllTokensForUser(storeId, 'STORE');
}

export async function forgotStorePassword(identifier: string) {
  const isEmail = identifier.includes('@');
  const store = await Store.findOne(isEmail ? { email: identifier.toLowerCase() } : { phone: identifier });
  if (!store) {
    // Do not reveal whether the account exists.
    return {};
  }
  return createResetToken('STORE', store.id, store.email);
}

export async function resetStorePassword(resetToken: string, newPassword: string) {
  const { userType, userId } = await consumeResetToken(resetToken);
  if (userType !== 'STORE') throw ApiError.badRequest('Invalid reset token', 'RESET_TOKEN_INVALID');

  const store = await Store.findById(userId);
  if (!store) throw ApiError.notFound('Store not found');

  store.password = await hashPassword(newPassword);
  await store.save();
  await revokeAllTokensForUser(userId, 'STORE');
}
