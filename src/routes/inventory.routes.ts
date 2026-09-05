import { Router } from 'express';
import * as controller from '../controllers/inventory.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  inventoryIdParamSchema,
  inventoryProductParamSchema,
  adjustInventorySchema,
  bulkUpdateInventorySchema,
} from '../validators/inventory.validator';

const router = Router();

router.use(authenticateAdmin);

// Static/prefixed routes must be declared before the generic '/:id' route.
router.get('/low-stock', requirePermission(PERMISSIONS.INVENTORY_VIEW), controller.lowStock);
router.get('/out-of-stock', requirePermission(PERMISSIONS.INVENTORY_VIEW), controller.outOfStock);
router.get(
  '/product/:productId',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  validate(inventoryProductParamSchema),
  controller.getByProduct,
);
router.post('/adjust', requirePermission(PERMISSIONS.INVENTORY_MANAGE), validate(adjustInventorySchema), controller.adjust);
router.post(
  '/bulk-update',
  requirePermission(PERMISSIONS.INVENTORY_MANAGE),
  validate(bulkUpdateInventorySchema),
  controller.bulkUpdate,
);

router.get('/', requirePermission(PERMISSIONS.INVENTORY_VIEW), controller.list);
router.get('/:id', requirePermission(PERMISSIONS.INVENTORY_VIEW), validate(inventoryIdParamSchema), controller.getById);
router.get(
  '/:id/history',
  requirePermission(PERMISSIONS.INVENTORY_VIEW),
  validate(inventoryIdParamSchema),
  controller.history,
);

export default router;
