import { Router } from 'express';
import * as controller from '../controllers/order.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin, authenticateCustomer } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createOrderSchema,
  orderIdParamSchema,
  updateOrderStatusSchema,
  cancelOrderSchema,
  updateOrderSchema,
} from '../validators/order.validator';

const router = Router();

const anyOrderActor = authenticate('ADMIN', 'VENDOR', 'DELIVERY_PARTNER', 'CUSTOMER');

router.get('/', anyOrderActor, requirePermission(PERMISSIONS.ORDER_VIEW), controller.list);
router.post('/', authenticateCustomer, validate(createOrderSchema), controller.create);
router.get('/:id', anyOrderActor, requirePermission(PERMISSIONS.ORDER_VIEW), validate(orderIdParamSchema), controller.getById);
router.patch('/:id', authenticateAdmin, requirePermission(PERMISSIONS.ORDER_UPDATE), validate(updateOrderSchema), controller.update);
router.patch(
  '/:id/status',
  authenticate('ADMIN', 'VENDOR', 'DELIVERY_PARTNER'),
  requirePermission(PERMISSIONS.ORDER_UPDATE),
  validate(updateOrderStatusSchema),
  controller.updateStatus,
);
router.post(
  '/:id/cancel',
  authenticate('ADMIN', 'VENDOR', 'CUSTOMER'),
  requirePermission(PERMISSIONS.ORDER_CANCEL),
  validate(cancelOrderSchema),
  controller.cancel,
);
router.get(
  '/:id/timeline',
  anyOrderActor,
  requirePermission(PERMISSIONS.ORDER_VIEW),
  validate(orderIdParamSchema),
  controller.timeline,
);
router.get('/:id/items', anyOrderActor, requirePermission(PERMISSIONS.ORDER_VIEW), validate(orderIdParamSchema), controller.items);

export default router;
