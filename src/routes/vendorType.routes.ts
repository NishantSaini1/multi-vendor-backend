import { Router } from 'express';
import * as controller from '../controllers/vendorType.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createVendorTypeSchema,
  updateVendorTypeSchema,
  vendorTypeIdParamSchema,
  updateVendorTypeStatusSchema,
} from '../validators/vendorType.validator';

const router = Router();

// A flat, global taxonomy (Multi-Cuisine, Pure Veg, Cloud Kitchen, ...) — read
// by every actor (Vendor App picks one at signup; Customer App filters/labels
// by it); write stays Admin-only since it's not any single vendor's own data.
const readAccess = authenticate('ADMIN', 'VENDOR', 'CUSTOMER');

router.get('/', readAccess, requirePermission(PERMISSIONS.VENDOR_TYPE_VIEW), controller.list);
router.post(
  '/',
  authenticateAdmin,
  requirePermission(PERMISSIONS.VENDOR_TYPE_MANAGE),
  validate(createVendorTypeSchema),
  controller.create,
);
router.get(
  '/:id',
  readAccess,
  requirePermission(PERMISSIONS.VENDOR_TYPE_VIEW),
  validate(vendorTypeIdParamSchema),
  controller.getById,
);
router.patch(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.VENDOR_TYPE_MANAGE),
  validate(updateVendorTypeSchema),
  controller.update,
);
router.delete(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.VENDOR_TYPE_MANAGE),
  validate(vendorTypeIdParamSchema),
  controller.remove,
);
router.patch(
  '/:id/status',
  authenticateAdmin,
  requirePermission(PERMISSIONS.VENDOR_TYPE_MANAGE),
  validate(updateVendorTypeStatusSchema),
  controller.updateStatus,
);

export default router;
