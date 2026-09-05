import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { verifyAccessToken } from '../utils/jwt';
import { UserType } from '../constants/roles';

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return null;
}

export function authenticate(...allowedUserTypes: UserType[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = extractToken(req);
    if (!token) {
      next(ApiError.unauthorized('Authentication token missing', 'TOKEN_MISSING'));
      return;
    }

    try {
      const payload = verifyAccessToken(token);
      if (allowedUserTypes.length > 0 && !allowedUserTypes.includes(payload.userType)) {
        next(ApiError.forbidden('You are not authorized to access this resource', 'USER_TYPE_FORBIDDEN'));
        return;
      }
      req.user = payload;
      next();
    } catch {
      next(ApiError.unauthorized('Invalid or expired token', 'TOKEN_INVALID'));
    }
  };
}

export const authenticateCustomer = authenticate('CUSTOMER');
export const authenticateVendor = authenticate('VENDOR');
export const authenticateDeliveryPartner = authenticate('DELIVERY_PARTNER');
export const authenticateAdmin = authenticate('ADMIN');
export const authenticateAny = authenticate();

// For public content endpoints that show more to a logged-in/privileged
// caller (e.g. Reviews: anonymous browsers and other customers see only
// VISIBLE reviews, but an admin with REVIEW_VIEW — or the review's own
// author — should see HIDDEN ones too). Never rejects: a missing or invalid
// token just leaves req.user unset rather than erroring, since the route
// itself is public.
export function authenticateOptional() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const token = extractToken(req);
    if (!token) {
      next();
      return;
    }
    try {
      req.user = verifyAccessToken(token);
    } catch {
      // Invalid/expired token on an optional-auth route: treat as anonymous
      // rather than failing the request.
    }
    next();
  };
}
