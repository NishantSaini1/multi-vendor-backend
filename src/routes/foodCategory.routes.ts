import { Router } from 'express';
import * as controller from '../controllers/foodCategory.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createFoodCategorySchema,
  updateFoodCategorySchema,
  foodCategoryIdParamSchema,
  updateFoodCategoryStatusSchema,
} from '../validators/foodCategory.validator';

const router = Router();

// Fully global, admin-managed taxonomy (mirrors instamartCategory.routes.ts)
// — read is shared with the Vendor App (for menu-building pickers) and
// Customer App (catalog browsing/filtering); write is Admin-only. Which
// categories a specific vendor may actually use is controlled separately via
// VendorCatalogAccess (see vendorCatalogAccess.routes wiring in vendor.routes.ts).
const readAccess = authenticate('ADMIN', 'VENDOR', 'CUSTOMER');

router.get('/', readAccess, requirePermission(PERMISSIONS.FOOD_CATALOG_VIEW), controller.list);
router.post(
  '/',
  authenticateAdmin,
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
  authenticateAdmin,
  requirePermission(PERMISSIONS.FOOD_CATALOG_MANAGE),
  validate(updateFoodCategorySchema),
  controller.update,
);
router.delete(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.FOOD_CATALOG_MANAGE),
  validate(foodCategoryIdParamSchema),
  controller.remove,
);
router.patch(
  '/:id/status',
  authenticateAdmin,
  requirePermission(PERMISSIONS.FOOD_CATALOG_MANAGE),
  validate(updateFoodCategoryStatusSchema),
  controller.updateStatus,
);

export default router;
