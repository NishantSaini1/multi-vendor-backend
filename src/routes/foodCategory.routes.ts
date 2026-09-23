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

// Global (admin-managed) and vendor-owned categories share these routes — see
// FoodCategory.ts. Read is shared with the Vendor App and Customer App. Write
// is open to ADMIN and VENDOR, but foodCategory.service.ts scopes a vendor to
// its OWN categories only: a vendor creating one always gets a vendor-owned
// category, and any write to a global category returns 403
// GLOBAL_CATEGORY_READ_ONLY. (requirePermission no-ops for a VENDOR actor.)
// Which global categories a vendor may use for its menu is controlled
// separately via VendorCatalogAccess (see vendor.routes.ts).
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
