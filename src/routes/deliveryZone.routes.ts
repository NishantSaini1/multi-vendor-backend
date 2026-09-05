import { Router } from 'express';
import * as controller from '../controllers/deliveryZone.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission, requireLocationAccess } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createDeliveryZoneSchema,
  updateDeliveryZoneSchema,
  deliveryZoneIdParamSchema,
  updateDeliveryZoneStatusSchema,
} from '../validators/deliveryZone.validator';

const router = Router();

router.use(authenticateAdmin);

router.get('/', requirePermission(PERMISSIONS.DELIVERY_ZONE_VIEW), controller.list);
router.post(
  '/',
  requirePermission(PERMISSIONS.DELIVERY_ZONE_MANAGE),
  validate(createDeliveryZoneSchema),
  requireLocationAccess((req) => req.body?.locationId),
  controller.create,
);
router.get('/:id', requirePermission(PERMISSIONS.DELIVERY_ZONE_VIEW), validate(deliveryZoneIdParamSchema), controller.getById);
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.DELIVERY_ZONE_MANAGE),
  validate(updateDeliveryZoneSchema),
  controller.update,
);
router.delete(
  '/:id',
  requirePermission(PERMISSIONS.DELIVERY_ZONE_MANAGE),
  validate(deliveryZoneIdParamSchema),
  controller.remove,
);
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.DELIVERY_ZONE_MANAGE),
  validate(updateDeliveryZoneStatusSchema),
  controller.updateStatus,
);

export default router;
