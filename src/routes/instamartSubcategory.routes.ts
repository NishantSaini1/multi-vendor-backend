import { Router } from 'express';
import * as controller from '../controllers/instamartCategory.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createInstamartSubcategorySchema,
  updateInstamartSubcategorySchema,
  instamartSubcategoryIdParamSchema,
  updateInstamartSubcategoryStatusSchema,
} from '../validators/instamartCategory.validator';

const router = Router();

// See instamartCategory.routes.ts: shared, admin-managed taxonomy — read is
// shared with Store App + Customer App. Categories stay Admin-only, but a
// STORE may add its own subcategory under a category it can see, and may
// edit/delete only a subcategory it created itself, and only while no other
// store has a product listed under it yet (enforced in
// instamartCategory.service.ts, not here — requirePermission below is a
// no-op for a STORE actor, same as every other Store-writable route).
const readAccess = authenticate('ADMIN', 'STORE', 'CUSTOMER');
const writeAccess = authenticate('ADMIN', 'STORE');

router.get('/', readAccess, requirePermission(PERMISSIONS.INSTAMART_CATALOG_VIEW), controller.listSubcategories);
router.post(
  '/',
  writeAccess,
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
  writeAccess,
  requirePermission(PERMISSIONS.INSTAMART_CATALOG_MANAGE),
  validate(updateInstamartSubcategorySchema),
  controller.updateSubcategory,
);
router.delete(
  '/:id',
  writeAccess,
  requirePermission(PERMISSIONS.INSTAMART_CATALOG_MANAGE),
  validate(instamartSubcategoryIdParamSchema),
  controller.removeSubcategory,
);
router.patch(
  '/:id/status',
  writeAccess,
  requirePermission(PERMISSIONS.INSTAMART_CATALOG_MANAGE),
  validate(updateInstamartSubcategoryStatusSchema),
  controller.updateSubcategoryStatus,
);

export default router;
