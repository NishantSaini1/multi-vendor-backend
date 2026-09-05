import { Router } from 'express';
import * as controller from '../controllers/foodCategory.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createFoodCategorySchema,
  updateFoodCategorySchema,
  foodCategoryIdParamSchema,
  updateFoodCategoryStatusSchema,
} from '../validators/foodCategory.validator';

const router = Router();

// Read access is shared with the Vendor App and Customer App (public catalog
// browsing); write access stays limited to Admin Panel + Vendor App, with
// ownership enforced in the service layer (see foodCategory.service.ts).
const readAccess = authenticate('ADMIN', 'VENDOR', 'CUSTOMER');
const writeAccess = authenticate('ADMIN', 'VENDOR');

router.get('/', readAccess, requirePermission(PERMISSIONS.FOOD_CATALOG_VIEW), controller.list);
router.post(
  '/',
  writeAccess,
  requirePermission(PERMISSIONS.FOOD_CATALOG_MANAGE),
  validate(createFoodCategorySchema),
  controller.create,
);
router.get(
  '/:id',
  readAccess,
  requirePermission(PERMISSIONS.FOOD_CATALOG_VIEW),
  validate(foodCategoryIdParamSchema),
  controller.getById,
);
router.patch(
  '/:id',
  writeAccess,
  requirePermission(PERMISSIONS.FOOD_CATALOG_MANAGE),
  validate(updateFoodCategorySchema),
  controller.update,
);
router.delete(
  '/:id',
  writeAccess,
  requirePermission(PERMISSIONS.FOOD_CATALOG_MANAGE),
  validate(foodCategoryIdParamSchema),
  controller.remove,
);
router.patch(
  '/:id/status',
  writeAccess,
  requirePermission(PERMISSIONS.FOOD_CATALOG_MANAGE),
  validate(updateFoodCategoryStatusSchema),
  controller.updateStatus,
);

export default router;
