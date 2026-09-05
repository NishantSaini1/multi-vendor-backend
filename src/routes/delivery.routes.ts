import { Router } from 'express';
import * as controller from '../controllers/delivery.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { deliveryIdParamSchema, updateDeliveryStatusSchema, listDeliveriesQuerySchema } from '../validators/delivery.validator';

const router = Router();

const anyDeliveryActor = authenticate('ADMIN', 'DELIVERY_PARTNER', 'CUSTOMER', 'VENDOR');
const operatorActor = authenticate('ADMIN', 'DELIVERY_PARTNER');

router.get('/', operatorActor, requirePermission(PERMISSIONS.DELIVERY_VIEW), validate(listDeliveriesQuerySchema), controller.list);
router.get('/:id', anyDeliveryActor, requirePermission(PERMISSIONS.DELIVERY_VIEW), validate(deliveryIdParamSchema), controller.getById);
router.get('/:id/tracking', anyDeliveryActor, requirePermission(PERMISSIONS.DELIVERY_VIEW), validate(deliveryIdParamSchema), controller.tracking);
router.patch(
  '/:id/status',
  operatorActor,
  requirePermission(PERMISSIONS.DELIVERY_ASSIGN),
  validate(updateDeliveryStatusSchema),
  controller.updateStatus,
);

export default router;
