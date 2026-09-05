import { JwtPayload } from './jwt';

// A well-known, fixed ObjectId (not a real AdminUser document) standing in
// for "the system" when a background job needs to call a service function
// that expects a JwtPayload — e.g. order.service.cancelOrder's
// changedBy/OrderStatusHistory fields require a real ObjectId, not an
// arbitrary string. role: SUPER_ADMIN + empty locationIds means every
// location-scoping check in rbac.middleware trivially passes, matching what
// a background sweep actually needs (it isn't scoped to one admin's
// location).
export const SYSTEM_ACTOR_ID = '000000000000000000000000';

export const SYSTEM_ACTOR: JwtPayload = {
  userId: SYSTEM_ACTOR_ID,
  userType: 'ADMIN',
  role: 'SUPER_ADMIN',
  locationIds: [],
};
