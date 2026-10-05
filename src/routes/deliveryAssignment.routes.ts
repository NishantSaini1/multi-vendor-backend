import { Router } from 'express';
import * as controller from '../controllers/deliveryAssignment.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { availablePartnersQuerySchema } from '../validators/deliveryPartner.validator';
import { assignDeliverySchema, reassignDeliverySchema } from '../validators/delivery.validator';
import {
  capacityStatusQuerySchema,
  capacitySettingsQuerySchema,
  updateCapacitySettingsSchema,
} from '../validators/deliveryCapacity.validator';

const router = Router();

router.use(authenticateAdmin);

router.get(
  '/available-partners',
  requirePermission(PERMISSIONS.DELIVERY_ASSIGN),
  validate(availablePartnersQuerySchema),
  controller.availablePartners,
);
// "High demand" control: whether customers can add to cart / order right now
// depends on free delivery partners; these show the live picture and let an admin
// tune or override it (see deliveryCapacity.service.ts).
router.get('/capacity-status', requirePermission(PERMISSIONS.DELIVERY_VIEW), validate(capacityStatusQuerySchema), controller.capacityStatus);
router.get('/capacity-settings', requirePermission(PERMISSIONS.DELIVERY_VIEW), validate(capacitySettingsQuerySchema), controller.capacitySettings);
router.put('/capacity-settings', requirePermission(PERMISSIONS.DELIVERY_ASSIGN), validate(updateCapacitySettingsSchema), controller.updateCapacitySettings);

router.post('/assign', requirePermission(PERMISSIONS.DELIVERY_ASSIGN), validate(assignDeliverySchema), controller.assign);
router.post('/reassign', requirePermission(PERMISSIONS.DELIVERY_REASSIGN), validate(reassignDeliverySchema), controller.reassign);

export default router;
