import { Router } from 'express';
import * as controller from '../controllers/vendorFoodItem.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  vendorIdParamSchema,
  vendorFoodItemIdParamSchema,
  createVendorFoodItemSchema,
  updateVendorFoodItemSchema,
  updateVendorFoodItemAvailabilitySchema,
  createFoodVariantSchema,
  updateFoodVariantSchema,
  foodVariantParamsSchema,
  createModifierGroupSchema,
  updateModifierGroupSchema,
  modifierGroupParamsSchema,
  createModifierOptionSchema,
  updateModifierOptionSchema,
  modifierOptionParamsSchema,
} from '../validators/vendorFoodItem.validator';

// Mounted at /vendors/:vendorId/food-items (see vendor.routes.ts) — mergeParams
// so req.params.vendorId from the parent router is visible here. A vendor may
// only manage their own menu; an admin follows ordinary location scoping —
// both enforced in vendorFoodItem.service.ts via assertOwnerOrLocationAccess.
const router = Router({ mergeParams: true });

const access = authenticate('ADMIN', 'VENDOR');

router.get('/', access, requirePermission(PERMISSIONS.VENDOR_FOOD_ITEM_VIEW), validate(vendorIdParamSchema), controller.list);
router.post(
  '/',
  access,
  requirePermission(PERMISSIONS.VENDOR_FOOD_ITEM_MANAGE),
  validate(createVendorFoodItemSchema),
  controller.create,
);
router.get(
  '/:id',
  access,
  requirePermission(PERMISSIONS.VENDOR_FOOD_ITEM_VIEW),
  validate(vendorFoodItemIdParamSchema),
  controller.getById,
);
router.patch(
  '/:id',
  access,
  requirePermission(PERMISSIONS.VENDOR_FOOD_ITEM_MANAGE),
  validate(updateVendorFoodItemSchema),
  controller.update,
);
router.delete(
  '/:id',
  access,
  requirePermission(PERMISSIONS.VENDOR_FOOD_ITEM_MANAGE),
  validate(vendorFoodItemIdParamSchema),
  controller.remove,
);
router.patch(
  '/:id/availability',
  access,
  requirePermission(PERMISSIONS.VENDOR_FOOD_ITEM_MANAGE),
  validate(updateVendorFoodItemAvailabilitySchema),
  controller.updateAvailability,
);

router.get(
  '/:id/variants',
  access,
  requirePermission(PERMISSIONS.VENDOR_FOOD_ITEM_VIEW),
  validate(vendorFoodItemIdParamSchema),
  controller.listVariants,
);
router.post(
  '/:id/variants',
  access,
  requirePermission(PERMISSIONS.VENDOR_FOOD_ITEM_MANAGE),
  validate(createFoodVariantSchema),
  controller.createVariant,
);
router.patch(
  '/:id/variants/:variantId',
  access,
  requirePermission(PERMISSIONS.VENDOR_FOOD_ITEM_MANAGE),
  validate(updateFoodVariantSchema),
  controller.updateVariant,
);
router.delete(
  '/:id/variants/:variantId',
  access,
  requirePermission(PERMISSIONS.VENDOR_FOOD_ITEM_MANAGE),
  validate(foodVariantParamsSchema),
  controller.deleteVariant,
);

router.get(
  '/:id/modifier-groups',
  access,
  requirePermission(PERMISSIONS.VENDOR_FOOD_ITEM_VIEW),
  validate(vendorFoodItemIdParamSchema),
  controller.listModifierGroups,
);
router.post(
  '/:id/modifier-groups',
  access,
  requirePermission(PERMISSIONS.MODIFIER_GROUP_MANAGE),
  validate(createModifierGroupSchema),
  controller.createModifierGroup,
);
router.patch(
  '/:id/modifier-groups/:groupId',
  access,
  requirePermission(PERMISSIONS.MODIFIER_GROUP_MANAGE),
  validate(updateModifierGroupSchema),
  controller.updateModifierGroup,
);
router.delete(
  '/:id/modifier-groups/:groupId',
  access,
  requirePermission(PERMISSIONS.MODIFIER_GROUP_MANAGE),
  validate(modifierGroupParamsSchema),
  controller.deleteModifierGroup,
);

router.get(
  '/:id/modifier-groups/:groupId/options',
  access,
  requirePermission(PERMISSIONS.VENDOR_FOOD_ITEM_VIEW),
  validate(modifierGroupParamsSchema),
  controller.listModifierOptions,
);
router.post(
  '/:id/modifier-groups/:groupId/options',
  access,
  requirePermission(PERMISSIONS.MODIFIER_GROUP_MANAGE),
  validate(createModifierOptionSchema),
  controller.createModifierOption,
);
router.patch(
  '/:id/modifier-groups/:groupId/options/:optionId',
  access,
  requirePermission(PERMISSIONS.MODIFIER_GROUP_MANAGE),
  validate(updateModifierOptionSchema),
  controller.updateModifierOption,
);
router.delete(
  '/:id/modifier-groups/:groupId/options/:optionId',
  access,
  requirePermission(PERMISSIONS.MODIFIER_GROUP_MANAGE),
  validate(modifierOptionParamsSchema),
  controller.deleteModifierOption,
);

export default router;
