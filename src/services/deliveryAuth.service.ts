import { DeliveryPartner } from '../models/DeliveryPartner';
import { ApiError } from '../utils/ApiError';
import { comparePassword, hashPassword } from '../utils/password';
import { issueTokenPair, rotateRefreshToken, revokeRefreshToken, revokeAllTokensForUser, DeviceInfo } from './token.service';
import { createResetToken, consumeResetToken } from './passwordReset.service';
import { JwtPayload } from '../utils/jwt';
import { DELIVERY_PARTNER_STATUS } from '../constants/deliveryStatus';

function assertPartnerLoginAllowed(status: string): void {
  if (status !== DELIVERY_PARTNER_STATUS.ACTIVE) {
    throw ApiError.forbidden('Your account must be approved and active to log in', 'DELIVERY_PARTNER_NOT_ACTIVE');
  }
}

async function buildPartnerPayload(partnerId: string): Promise<JwtPayload> {
  const partner = await DeliveryPartner.findById(partnerId);
  if (!partner) throw ApiError.unauthorized('Delivery partner not found', 'DELIVERY_PARTNER_NOT_FOUND');
  assertPartnerLoginAllowed(partner.status);
  return {
    userId: partner.id,
    userType: 'DELIVERY_PARTNER',
    role: 'DELIVERY_PARTNER',
    locationIds: [partner.locationId.toString()],
  };
}

export async function loginDeliveryPartner(phone: string, password: string, device: DeviceInfo) {
  const partner = await DeliveryPartner.findOne({ phone }).select('+password');
  if (!partner) throw ApiError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');

  const isMatch = await comparePassword(password, partner.password);
  if (!isMatch) throw ApiError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');

  assertPartnerLoginAllowed(partner.status);

  const payload: JwtPayload = {
    userId: partner.id,
    userType: 'DELIVERY_PARTNER',
    role: 'DELIVERY_PARTNER',
    locationIds: [partner.locationId.toString()],
  };
  const tokens = await issueTokenPair(payload, device);
  return { partner, tokens };
}

export async function refreshDeliveryTokens(refreshToken: string, device: DeviceInfo) {
  return rotateRefreshToken(refreshToken, (userId) => buildPartnerPayload(userId), device);
}

export async function logoutDeliveryPartner(refreshToken: string) {
  await revokeRefreshToken(refreshToken);
}

export async function logoutAllDeliveryPartnerSessions(partnerId: string) {
  await revokeAllTokensForUser(partnerId, 'DELIVERY_PARTNER');
}

export async function changeDeliveryPartnerPassword(partnerId: string, currentPassword: string, newPassword: string) {
  const partner = await DeliveryPartner.findById(partnerId).select('+password');
  if (!partner) throw ApiError.notFound('Delivery partner not found');

  const isMatch = await comparePassword(currentPassword, partner.password);
  if (!isMatch) throw ApiError.unauthorized('Current password is incorrect', 'INVALID_CURRENT_PASSWORD');

  partner.password = await hashPassword(newPassword);
  await partner.save();
  await revokeAllTokensForUser(partnerId, 'DELIVERY_PARTNER');
}

export async function forgotDeliveryPartnerPassword(phone: string) {
  const partner = await DeliveryPartner.findOne({ phone });
  if (!partner) return {};
  return createResetToken('DELIVERY_PARTNER', partner.id, partner.email);
}

export async function resetDeliveryPartnerPassword(resetToken: string, newPassword: string) {
  const { userType, userId } = await consumeResetToken(resetToken);
  if (userType !== 'DELIVERY_PARTNER') throw ApiError.badRequest('Invalid reset token', 'RESET_TOKEN_INVALID');

  const partner = await DeliveryPartner.findById(userId);
  if (!partner) throw ApiError.notFound('Delivery partner not found');

  partner.password = await hashPassword(newPassword);
  await partner.save();
  await revokeAllTokensForUser(userId, 'DELIVERY_PARTNER');
}
