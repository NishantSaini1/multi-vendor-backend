import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { UserType } from '../constants/roles';

export interface JwtPayload {
  userId: string;
  userType: UserType;
  role: string;
  locationIds: string[];
}

function accessTokenExpiry(userType: UserType): string {
  if (userType === 'ADMIN') return env.JWT_ADMIN_EXPIRES_IN;
  if (userType === 'VENDOR') return env.JWT_VENDOR_EXPIRES_IN;
  return env.JWT_EXPIRES_IN;
}

export function signAccessToken(payload: JwtPayload): string {
  const options: SignOptions = { expiresIn: accessTokenExpiry(payload.userType) as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function signRefreshToken(payload: Pick<JwtPayload, 'userId' | 'userType'> & { tokenId: string }): string {
  const options: SignOptions = { expiresIn: env.JWT_REFRESH_EXPIRES_IN as SignOptions['expiresIn'] };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

export function verifyRefreshToken(token: string): { userId: string; userType: UserType; tokenId: string } {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as {
    userId: string;
    userType: UserType;
    tokenId: string;
  };
}
