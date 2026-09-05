import { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken, JwtPayload } from '../../src/utils/jwt';

describe('jwt utils', () => {
  const payload: JwtPayload = {
    userId: '507f1f77bcf86cd799439011',
    userType: 'CUSTOMER',
    role: 'CUSTOMER',
    locationIds: [],
  };

  it('signs and verifies an access token round-trip', () => {
    const token = signAccessToken(payload);
    const decoded = verifyAccessToken(token);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.userType).toBe('CUSTOMER');
  });

  it('signs and verifies a refresh token round-trip', () => {
    const token = signRefreshToken({ userId: payload.userId, userType: payload.userType, tokenId: 'abc-123' });
    const decoded = verifyRefreshToken(token);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.tokenId).toBe('abc-123');
  });

  it('rejects a tampered access token', () => {
    const token = signAccessToken(payload);
    expect(() => verifyAccessToken(`${token}tampered`)).toThrow();
  });

  it('uses a longer expiry for admin access tokens', () => {
    const adminToken = signAccessToken({ ...payload, userType: 'ADMIN', role: 'SUPER_ADMIN' });
    const decoded = verifyAccessToken(adminToken) as JwtPayload & { exp: number; iat: number };
    const customerToken = signAccessToken(payload);
    const decodedCustomer = verifyAccessToken(customerToken) as JwtPayload & { exp: number; iat: number };

    const adminTtl = decoded.exp - decoded.iat;
    const customerTtl = decodedCustomer.exp - decodedCustomer.iat;
    expect(adminTtl).toBeGreaterThan(customerTtl);
  });
});
