import { Router } from 'express';
import * as controller from '../controllers/foodProduct.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createFoodProductSchema,
  updateFoodProductSchema,
  foodProductIdParamSchema,
  updateFoodProductStatusSchema,
  updateFoodProductAvailabilitySchema,
  createFoodVariantSchema,
  updateFoodVariantSchema,
  foodVariantParamsSchema,
  foodProductVariantsListSchema,
} from '../validators/foodProduct.validator';

const router = Router();

// Shared by the Admin Panel and the Vendor App — ownership is enforced in the
// service layer (see foodProduct.service.ts), not by route-level RBAC alone.
router.use(authenticate('ADMIN', 'VENDOR'));

router.get('/', requirePermission(PERMISSIONS.FOOD_PRODUCT_VIEW), controller.list);
router.post('/', requirePermission(PERMISSIONS.FOOD_PRODUCT_MANAGE), validate(createFoodProductSchema), controller.create);
router.get('/:id', requirePermission(PERMISSIONS.FOOD_PRODUCT_VIEW), validate(foodProductIdParamSchema), controller.getById);
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.FOOD_PRODUCT_MANAGE),
  validate(updateFoodProductSchema),
  controller.update,
);
router.delete(
  '/:id',
  requirePermission(PERMISSIONS.FOOD_PRODUCT_MANAGE),
  validate(foodProductIdParamSchema),
  controller.remove,
);
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.FOOD_PRODUCT_MANAGE),
  validate(updateFoodProductStatusSchema),
  controller.updateStatus,
);
router.patch(
  '/:id/availability',
  requirePermission(PERMISSIONS.FOOD_PRODUCT_MANAGE),
  validate(updateFoodProductAvailabilitySchema),
  controller.updateAvailability,
);

router.get(
  '/:productId/variants',
  requirePermission(PERMISSIONS.FOOD_PRODUCT_VIEW),
  validate(foodProductVariantsListSchema),
  controller.listVariants,
);
router.post(
  '/:productId/variants',
  requirePermission(PERMISSIONS.FOOD_PRODUCT_MANAGE),
  validate(createFoodVariantSchema),
  controller.createVariant,
);
router.patch(
  '/:productId/variants/:variantId',
  requirePermission(PERMISSIONS.FOOD_PRODUCT_MANAGE),
  validate(updateFoodVariantSchema),
  controller.updateVariant,
);
router.delete(
  '/:productId/variants/:variantId',
  requirePermission(PERMISSIONS.FOOD_PRODUCT_MANAGE),
  validate(foodVariantParamsSchema),
  controller.deleteVariant,
);

export default router;
