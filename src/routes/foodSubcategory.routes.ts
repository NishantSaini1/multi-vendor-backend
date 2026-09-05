import { Router } from 'express';
import * as controller from '../controllers/foodSubcategory.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createFoodSubcategorySchema,
  updateFoodSubcategorySchema,
  foodSubcategoryIdParamSchema,
  updateFoodSubcategoryStatusSchema,
} from '../validators/foodSubcategory.validator';

const router = Router();

// See foodCategory.routes.ts: read is shared with Vendor App + Customer App,
// write stays Admin Panel + Vendor App with ownership enforced in the service.
const readAccess = authenticate('ADMIN', 'VENDOR', 'CUSTOMER');
const writeAccess = authenticate('ADMIN', 'VENDOR');

router.get('/', readAccess, requirePermission(PERMISSIONS.FOOD_CATALOG_VIEW), controller.list);
router.post(
  '/',
  writeAccess,
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
  writeAccess,
  requirePermission(PERMISSIONS.FOOD_CATALOG_MANAGE),
  validate(updateFoodSubcategorySchema),
  controller.update,
);
router.delete(
  '/:id',
  writeAccess,
  requirePermission(PERMISSIONS.FOOD_CATALOG_MANAGE),
  validate(foodSubcategoryIdParamSchema),
  controller.remove,
);
router.patch(
  '/:id/status',
  writeAccess,
  requirePermission(PERMISSIONS.FOOD_CATALOG_MANAGE),
  validate(updateFoodSubcategoryStatusSchema),
  controller.updateStatus,
);

export default router;
