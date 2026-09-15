import { Router } from 'express';
import * as controller from '../controllers/foodSubcategory.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createFoodSubcategorySchema,
  updateFoodSubcategorySchema,
  foodSubcategoryIdParamSchema,
  updateFoodSubcategoryStatusSchema,
} from '../validators/foodSubcategory.validator';

const router = Router();

// See foodCategory.routes.ts: fully global, admin-managed taxonomy — read is
// shared with Vendor App + Customer App, write is Admin-only.
const readAccess = authenticate('ADMIN', 'VENDOR', 'CUSTOMER');

router.get('/', readAccess, requirePermission(PERMISSIONS.FOOD_CATALOG_VIEW), controller.list);
router.post(
  '/',
  authenticateAdmin,
  requirePermission(PERMISSIONS.FOOD_CATALOG_MANAGE),
  validate(createFoodSubcategorySchema),
  controller.create,
);
router.get(
  '/:id',
  readAccess,
  requirePermission(PERMISSIONS.FOOD_CATALOG_VIEW),
  validate(foodSubcategoryIdParamSchema),
  controller.getById,
);
router.patch(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.FOOD_CATALOG_MANAGE),
  validate(updateFoodSubcategorySchema),
  controller.update,
);
router.delete(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.FOOD_CATALOG_MANAGE),
  validate(foodSubcategoryIdParamSchema),
  controller.remove,
);
router.patch(
  '/:id/status',
  authenticateAdmin,
  requirePermission(PERMISSIONS.FOOD_CATALOG_MANAGE),
  validate(updateFoodSubcategoryStatusSchema),
  controller.updateStatus,
);

export default router;
