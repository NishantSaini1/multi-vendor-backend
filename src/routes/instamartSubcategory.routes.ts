import { Router } from 'express';
import * as controller from '../controllers/instamartCategory.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createInstamartSubcategorySchema,
  updateInstamartSubcategorySchema,
  instamartSubcategoryIdParamSchema,
  updateInstamartSubcategoryStatusSchema,
} from '../validators/instamartCategory.validator';

const router = Router();

// See instamartCategory.routes.ts: read is shared with the Customer App,
// write stays Admin-only.
const readAccess = authenticate('ADMIN', 'CUSTOMER');

router.get('/', readAccess, requirePermission(PERMISSIONS.INSTAMART_CATALOG_VIEW), controller.listSubcategories);
router.post(
  '/',
  authenticateAdmin,
  requirePermission(PERMISSIONS.INSTAMART_CATALOG_MANAGE),
  validate(createInstamartSubcategorySchema),
  controller.createSubcategory,
);
router.get(
  '/:id',
  readAccess,
  requirePermission(PERMISSIONS.INSTAMART_CATALOG_VIEW),
  validate(instamartSubcategoryIdParamSchema),
  controller.getSubcategoryById,
);
router.patch(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.INSTAMART_CATALOG_MANAGE),
  validate(updateInstamartSubcategorySchema),
  controller.updateSubcategory,
);
router.delete(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.INSTAMART_CATALOG_MANAGE),
  validate(instamartSubcategoryIdParamSchema),
  controller.removeSubcategory,
);
router.patch(
  '/:id/status',
  authenticateAdmin,
  requirePermission(PERMISSIONS.INSTAMART_CATALOG_MANAGE),
  validate(updateInstamartSubcategoryStatusSchema),
  controller.updateSubcategoryStatus,
);

export default router;
