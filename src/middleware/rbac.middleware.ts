import { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import { Permission, ROLE_DEFAULT_PERMISSIONS } from '../constants/permissions';
import { ADMIN_ROLES } from '../constants/roles';
import { JwtPayload } from '../utils/jwt';

// RBAC permissions only apply to ADMIN actors. Routes shared with a VENDOR (or
// other) actor rely on ownership checks in the service layer instead (see
// `assertOwnerOrLocationAccess`) — a vendor's role is 'VENDOR', which has no
// entry in ROLE_DEFAULT_PERMISSIONS, so this check is skipped for them rather
// than always denying.
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }

    if (req.user.userType !== 'ADMIN') {
      next();
      return;
    }

    if (req.user.role === ADMIN_ROLES.SUPER_ADMIN) {
      next();
      return;
    }

    const granted = ROLE_DEFAULT_PERMISSIONS[req.user.role] ?? [];
    const hasAll = permissions.every((p) => granted.includes(p));

    if (!hasAll) {
      next(ApiError.forbidden('You do not have permission to perform this action', 'PERMISSION_DENIED'));
      return;
    }

    next();
  };
}

// An admin's `locationIds` restricts them only when non-empty (e.g. LOCATION_ADMIN
// scoped to specific towns). An empty array means "not location-restricted" — used
// by role-scoped admins (FOOD_ADMIN, DELIVERY_ADMIN, ...) who operate across every
// location and rely on `requirePermission` instead. SUPER_ADMIN always bypasses.
export function hasLocationAccess(user: JwtPayload, locationId: string | undefined): boolean {
  if (user.role === ADMIN_ROLES.SUPER_ADMIN) return true;
  if (!locationId) return true;
  if (user.locationIds.length === 0) return true;
  return user.locationIds.includes(locationId);
}

export function assertLocationAccess(user: JwtPayload, locationId: string | undefined): void {
  if (!hasLocationAccess(user, locationId)) {
    throw ApiError.forbidden('You do not have access to this location', 'LOCATION_FORBIDDEN');
  }
}

// For list endpoints: returns a Mongo filter fragment restricting results to the
// admin's assigned locations, or {} when they are unrestricted (SUPER_ADMIN, or a
// role-scoped admin with no explicit location assignments).
export function locationScopeFilter(user: JwtPayload, field = 'locationId'): Record<string, unknown> {
  if (user.role === ADMIN_ROLES.SUPER_ADMIN || user.locationIds.length === 0) {
    return {};
  }
  return { [field]: { $in: user.locationIds } };
}

// Enforces that the target locationId (from params/query/body) is within the
// admin's assigned locationIds, per the semantics above. Use for routes where the
// location is known before the target entity is fetched (e.g. /locations/:id,
// or create payloads carrying locationId directly). For routes where the entity's
// locationId is only known after a DB lookup (e.g. /vendors/:id), call
// `assertLocationAccess` from the service/controller after fetching instead.
export function requireLocationAccess(getLocationId: (req: Request) => string | undefined = defaultLocationExtractor) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }

    try {
      assertLocationAccess(req.user, getLocationId(req));
      next();
    } catch (err) {
      next(err);
    }
  };
}

function defaultLocationExtractor(req: Request): string | undefined {
  return (req.params.locationId || req.query.locationId || req.body?.locationId) as string | undefined;
}

// For resources owned by a non-admin actor (a vendor's food products/addons, a
// delivery partner's own profile/availability/location, ...) that both the
// owning actor and a location-scoped ADMIN can manage. The owning actor may
// only touch their own resource; an admin is subject to ordinary
// location-based authorization instead. Note: Store has no separate login of
// its own per the spec (only Customer/Vendor/DeliveryPartner/Admin do) —
// Instamart product/store management is admin-only, so this helper is never
// used for Store.
export function assertOwnerOrLocationAccess(user: JwtPayload, ownerId: string, locationId: string): void {
  if (user.userType !== 'ADMIN') {
    if (user.userId !== ownerId) {
      throw ApiError.forbidden('You do not have access to this resource', 'OWNER_FORBIDDEN');
    }
    return;
  }
  assertLocationAccess(user, locationId);
}
