import { Router } from 'express';
import * as controller from '../controllers/adminUser.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createAdminUserSchema,
  updateAdminUserSchema,
  updateAdminUserStatusSchema,
  resetAdminUserPasswordSchema,
  adminUserIdParamSchema,
  listAdminUsersQuerySchema,
} from '../validators/adminUser.validator';

const router = Router();

// Platform-level admin-user/role management is SUPER_ADMIN-exclusive per
// this codebase's established convention (ADMIN_USER_*/ACTIVITY_LOG_VIEW
// permissions are only ever granted to SUPER_ADMIN — see permissions.ts).
router.use(authenticateAdmin);

// Static/prefixed routes must be declared before the generic '/:id' route.
router.get('/roles', requirePermission(PERMISSIONS.ADMIN_USER_VIEW), controller.roles);
router.get('/permissions', requirePermission(PERMISSIONS.ADMIN_USER_VIEW), controller.permissions);

router.get('/', requirePermission(PERMISSIONS.ADMIN_USER_VIEW), validate(listAdminUsersQuerySchema), controller.list);
router.post('/', requirePermission(PERMISSIONS.ADMIN_USER_CREATE), validate(createAdminUserSchema), controller.create);
router.get('/:id', requirePermission(PERMISSIONS.ADMIN_USER_VIEW), validate(adminUserIdParamSchema), controller.getById);
router.patch('/:id', requirePermission(PERMISSIONS.ADMIN_USER_UPDATE), validate(updateAdminUserSchema), controller.update);
router.delete('/:id', requirePermission(PERMISSIONS.ADMIN_USER_DELETE), validate(adminUserIdParamSchema), controller.remove);
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.ADMIN_USER_UPDATE),
  validate(updateAdminUserStatusSchema),
  controller.updateStatus,
);
router.post(
  '/:id/reset-password',
  requirePermission(PERMISSIONS.ADMIN_USER_UPDATE),
  validate(resetAdminUserPasswordSchema),
  controller.resetPassword,
);

export default router;
