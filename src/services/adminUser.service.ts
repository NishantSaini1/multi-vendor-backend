import { AdminUser } from '../models/AdminUser';
import { Location } from '../models/Location';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { hashPassword } from '../utils/password';
import { revokeAllTokensForUser } from './token.service';
import { CUSTOMER_STATUS } from '../constants/enums';
import { ADMIN_ROLES, ADMIN_ROLE_LIST } from '../constants/roles';
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } from '../constants/permissions';

async function assertLocationsExist(locationIds: string[]): Promise<void> {
  if (locationIds.length === 0) return;
  const count = await Location.countDocuments({ _id: { $in: locationIds } });
  if (count !== new Set(locationIds).size) {
    throw ApiError.badRequest('One or more locationIds do not exist', 'LOCATION_NOT_FOUND');
  }
}

export async function listAdminUsers(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    AdminUser.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    AdminUser.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createAdminUser(data: { name: string; email: string; password: string; role: string; locationIds: string[] }) {
  const existing = await AdminUser.findOne({ email: data.email.toLowerCase() });
  if (existing) throw ApiError.conflict('An admin with this email already exists', 'ADMIN_EMAIL_EXISTS');

  await assertLocationsExist(data.locationIds);

  const password = await hashPassword(data.password);
  return AdminUser.create({
    name: data.name,
    email: data.email.toLowerCase(),
    password,
    role: data.role,
    locationIds: data.locationIds,
  });
}

async function findAdminUserOrThrow(id: string) {
  const admin = await AdminUser.findById(id);
  if (!admin) throw ApiError.notFound('Admin user not found', 'ADMIN_USER_NOT_FOUND');
  return admin;
}

export async function getAdminUserById(id: string) {
  return findAdminUserOrThrow(id);
}

export async function updateAdminUser(id: string, data: Record<string, unknown>) {
  const admin = await findAdminUserOrThrow(id);

  if (typeof data.email === 'string') {
    const email = data.email.toLowerCase();
    if (email !== admin.email) {
      const existing = await AdminUser.findOne({ email });
      if (existing) throw ApiError.conflict('An admin with this email already exists', 'ADMIN_EMAIL_EXISTS');
    }
    data.email = email;
  }
  if (Array.isArray(data.locationIds)) await assertLocationsExist(data.locationIds as string[]);

  Object.assign(admin, data);
  await admin.save();
  return admin;
}

async function countActiveSuperAdmins(excludingId?: string): Promise<number> {
  const filter: Record<string, unknown> = { role: ADMIN_ROLES.SUPER_ADMIN, status: CUSTOMER_STATUS.ACTIVE };
  if (excludingId) filter._id = { $ne: excludingId };
  return AdminUser.countDocuments(filter);
}

export async function updateAdminUserStatus(id: string, status: string, actingAdmin: JwtPayload) {
  const admin = await findAdminUserOrThrow(id);

  if (admin.id === actingAdmin.userId) {
    throw ApiError.badRequest('You cannot change your own account status', 'CANNOT_MODIFY_SELF');
  }
  if (status !== CUSTOMER_STATUS.ACTIVE && admin.role === ADMIN_ROLES.SUPER_ADMIN) {
    const remaining = await countActiveSuperAdmins(admin.id);
    if (remaining === 0) {
      throw ApiError.badRequest('Cannot deactivate the last active super admin', 'LAST_SUPER_ADMIN');
    }
  }

  admin.status = status;
  await admin.save();

  if (status !== CUSTOMER_STATUS.ACTIVE) {
    await revokeAllTokensForUser(admin.id, 'ADMIN');
  }

  return admin;
}

export async function deleteAdminUser(id: string, actingAdmin: JwtPayload) {
  const admin = await findAdminUserOrThrow(id);

  if (admin.id === actingAdmin.userId) {
    throw ApiError.badRequest('You cannot delete your own account', 'CANNOT_MODIFY_SELF');
  }
  if (admin.role === ADMIN_ROLES.SUPER_ADMIN) {
    const remaining = await countActiveSuperAdmins(admin.id);
    if (remaining === 0) {
      throw ApiError.badRequest('Cannot delete the last active super admin', 'LAST_SUPER_ADMIN');
    }
  }

  await admin.deleteOne();
  await revokeAllTokensForUser(id, 'ADMIN');
}

export async function resetAdminUserPassword(id: string, newPassword: string) {
  const admin = await findAdminUserOrThrow(id);
  admin.password = await hashPassword(newPassword);
  await admin.save();
  await revokeAllTokensForUser(admin.id, 'ADMIN');
  return admin;
}

// Read-only reference/introspection for an admin frontend's role picker —
// RBAC in this codebase is a static, code-defined map (ROLE_DEFAULT_
// PERMISSIONS), not a dynamic per-tenant editor, so this exposes what
// already exists rather than pretending permissions can be edited at
// runtime.
export function listRoles() {
  return ADMIN_ROLE_LIST.map((role) => ({
    role,
    permissions: role === ADMIN_ROLES.SUPER_ADMIN ? Object.values(PERMISSIONS) : (ROLE_DEFAULT_PERMISSIONS[role] ?? []),
  }));
}

export function listPermissions() {
  return Object.values(PERMISSIONS);
}
