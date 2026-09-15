import { Router } from 'express';
import * as controller from '../controllers/instamartCategory.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createInstamartCategorySchema,
  updateInstamartCategorySchema,
  instamartCategoryIdParamSchema,
  updateInstamartCategoryStatusSchema,
} from '../validators/instamartCategory.validator';

const router = Router();

// Shared, admin-managed taxonomy (a marketplace of independent stores needs
// one canonical category every store's products reference, not each store
// inventing its own) — read is shared with Store App + Customer App (so a
// store can browse the taxonomy to assign its products, and customers can
// browse/filter by it); write stays Admin-only.
const readAccess = authenticate('ADMIN', 'STORE', 'CUSTOMER');

router.get('/', readAccess, requirePermission(PERMISSIONS.INSTAMART_CATALOG_VIEW), controller.list);
router.post(
  '/',
  authenticateAdmin,
  requirePermission(PERMISSIONS.INSTAMART_CATALOG_MANAGE),
  validate(createInstamartCategorySchema),
  controller.create,
);
router.get(
  '/:id',
  readAccess,
  requirePermission(PERMISSIONS.INSTAMART_CATALOG_VIEW),
  validate(instamartCategoryIdParamSchema),
  controller.getById,
);
router.patch(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.INSTAMART_CATALOG_MANAGE),
  validate(updateInstamartCategorySchema),
  controller.update,
);
router.delete(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.INSTAMART_CATALOG_MANAGE),
  validate(instamartCategoryIdParamSchema),
  controller.remove,
);
router.patch(
  '/:id/status',
  authenticateAdmin,
  requirePermission(PERMISSIONS.INSTAMART_CATALOG_MANAGE),
  validate(updateInstamartCategoryStatusSchema),
  controller.updateStatus,
);

export default router;
