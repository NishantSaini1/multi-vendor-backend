import { Router } from 'express';
import * as controller from '../controllers/foodAddon.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { createFoodAddonSchema, updateFoodAddonSchema, foodAddonIdParamSchema } from '../validators/foodAddon.validator';

const router = Router();

router.use(authenticate('ADMIN', 'VENDOR'));

router.get('/', requirePermission(PERMISSIONS.FOOD_PRODUCT_VIEW), controller.list);
router.post('/', requirePermission(PERMISSIONS.FOOD_PRODUCT_MANAGE), validate(createFoodAddonSchema), controller.create);
router.get('/:id', requirePermission(PERMISSIONS.FOOD_PRODUCT_VIEW), validate(foodAddonIdParamSchema), controller.getById);
router.patch('/:id', requirePermission(PERMISSIONS.FOOD_PRODUCT_MANAGE), validate(updateFoodAddonSchema), controller.update);
router.delete(
  '/:id',
  requirePermission(PERMISSIONS.FOOD_PRODUCT_MANAGE),
  validate(foodAddonIdParamSchema),
  controller.remove,
);

export default router;
