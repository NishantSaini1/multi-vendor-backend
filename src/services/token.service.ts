import { v4 as uuid } from 'uuid';
import ms from '../utils/ms';
import { RefreshToken } from '../models/RefreshToken';
import { signAccessToken, signRefreshToken, verifyRefreshToken, JwtPayload } from '../utils/jwt';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { UserType } from '../constants/roles';

export interface DeviceInfo {
  deviceId?: string;
  deviceType?: string;
  ip?: string;
  userAgent?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export async function issueTokenPair(payload: JwtPayload, device: DeviceInfo = {}): Promise<TokenPair> {
  const tokenId = uuid();
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken({ userId: payload.userId, userType: payload.userType, tokenId });

  await RefreshToken.create({
    tokenId,
    userId: payload.userId,
    userType: payload.userType,
    deviceId: device.deviceId,
    deviceType: device.deviceType,
    ip: device.ip,
    userAgent: device.userAgent,
    expiresAt: new Date(Date.now() + ms(env.JWT_REFRESH_EXPIRES_IN)),
  });

  return { accessToken, refreshToken };
}

export async function rotateRefreshToken(
  refreshToken: string,
  buildPayload: (userId: string, userType: UserType) => Promise<JwtPayload>,
  device: DeviceInfo = {},
): Promise<TokenPair> {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token', 'REFRESH_TOKEN_INVALID');
  }

  const stored = await RefreshToken.findOne({ tokenId: decoded.tokenId });
  if (!stored || stored.revoked || stored.expiresAt < new Date()) {
    throw ApiError.unauthorized('Refresh token has been revoked or expired', 'REFRESH_TOKEN_INVALID');
  }

  stored.revoked = true;
  await stored.save();

  const payload = await buildPayload(decoded.userId, decoded.userType);
  return issueTokenPair(payload, device);
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  try {
    const decoded = verifyRefreshToken(refreshToken);
    await RefreshToken.updateOne({ tokenId: decoded.tokenId }, { revoked: true });
  } catch {
    // Token already invalid/expired — nothing to revoke.
  }
}

export async function revokeAllTokensForUser(userId: string, userType: UserType): Promise<void> {
  await RefreshToken.updateMany({ userId, userType, revoked: false }, { revoked: true });
}

export async function listActiveSessions(userId: string, userType: UserType) {
  return RefreshToken.find({ userId, userType, revoked: false, expiresAt: { $gt: new Date() } })
    .select('tokenId deviceId deviceType ip userAgent createdAt')
    .sort({ createdAt: -1 });
}

export async function revokeSessionById(userId: string, userType: UserType, refreshTokenDocId: string): Promise<void> {
  await RefreshToken.updateOne({ _id: refreshTokenDocId, userId, userType }, { revoked: true });
}
