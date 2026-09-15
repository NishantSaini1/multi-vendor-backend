import { Router } from 'express';
import * as controller from '../controllers/foodProduct.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createFoodProductSchema,
  updateFoodProductSchema,
  foodProductIdParamSchema,
  updateFoodProductStatusSchema,
} from '../validators/foodProduct.validator';

const router = Router();

// The GLOBAL Food Item catalog (mirrors instamart/global-products) — read is
// shared with the Vendor App (the "add existing item" browse/search picker)
// and Customer App (restaurant menu browsing); write is Admin-only — a
// vendor's own "propose a brand-new item" path is /food-item-submissions
// instead (see foodItemSubmission.routes.ts). Per-vendor price/availability/
// variants/modifiers live under /vendors/:vendorId/food-items.
const readAccess = authenticate('ADMIN', 'VENDOR', 'CUSTOMER');

router.get('/', readAccess, requirePermission(PERMISSIONS.GLOBAL_FOOD_ITEM_VIEW), controller.list);
router.post(
  '/',
  authenticateAdmin,
  requirePermission(PERMISSIONS.GLOBAL_FOOD_ITEM_MANAGE),
  validate(createFoodProductSchema),
  controller.create,
);
router.get(
  '/:id',
  readAccess,
  requirePermission(PERMISSIONS.GLOBAL_FOOD_ITEM_VIEW),
  validate(foodProductIdParamSchema),
  controller.getById,
);
router.patch(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.GLOBAL_FOOD_ITEM_MANAGE),
  validate(updateFoodProductSchema),
  controller.update,
);
router.delete(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.GLOBAL_FOOD_ITEM_MANAGE),
  validate(foodProductIdParamSchema),
  controller.remove,
);
router.patch(
  '/:id/status',
  authenticateAdmin,
  requirePermission(PERMISSIONS.GLOBAL_FOOD_ITEM_MANAGE),
  validate(updateFoodProductStatusSchema),
  controller.updateStatus,
);

export default router;
