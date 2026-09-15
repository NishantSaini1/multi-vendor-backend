import { Router } from 'express';
import * as controller from '../controllers/storeType.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createStoreTypeSchema,
  updateStoreTypeSchema,
  storeTypeIdParamSchema,
  updateStoreTypeStatusSchema,
} from '../validators/storeType.validator';

const router = Router();

// A flat, global taxonomy (like Grocery/Veg & Fruits/Cosmetics) shared across
// every store of that type — read by every actor (Store App picks one at
// creation time via the Admin Panel; Customer App filters/labels by it),
// write stays Admin-only since it's not any single store's own data.
const readAccess = authenticate('ADMIN', 'STORE', 'CUSTOMER');

router.get('/', readAccess, requirePermission(PERMISSIONS.STORE_TYPE_VIEW), controller.list);
router.post(
  '/',
  authenticateAdmin,
  requirePermission(PERMISSIONS.STORE_TYPE_MANAGE),
  validate(createStoreTypeSchema),
  controller.create,
);
router.get(
  '/:id',
  readAccess,
  requirePermission(PERMISSIONS.STORE_TYPE_VIEW),
  validate(storeTypeIdParamSchema),
  controller.getById,
);
router.patch(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.STORE_TYPE_MANAGE),
  validate(updateStoreTypeSchema),
  controller.update,
);
router.delete(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.STORE_TYPE_MANAGE),
  validate(storeTypeIdParamSchema),
  controller.remove,
);
router.patch(
  '/:id/status',
  authenticateAdmin,
  requirePermission(PERMISSIONS.STORE_TYPE_MANAGE),
  validate(updateStoreTypeStatusSchema),
  controller.updateStatus,
);

export default router;
