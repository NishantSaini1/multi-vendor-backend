import { Router } from 'express';
import * as controller from '../controllers/deliveryAssignment.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { availablePartnersQuerySchema } from '../validators/deliveryPartner.validator';
import { assignDeliverySchema, reassignDeliverySchema } from '../validators/delivery.validator';

const router = Router();

router.use(authenticateAdmin);

router.get(
  '/available-partners',
  requirePermission(PERMISSIONS.DELIVERY_ASSIGN),
  validate(availablePartnersQuerySchema),
  controller.availablePartners,
);
router.post('/assign', requirePermission(PERMISSIONS.DELIVERY_ASSIGN), validate(assignDeliverySchema), controller.assign);
router.post('/reassign', requirePermission(PERMISSIONS.DELIVERY_REASSIGN), validate(reassignDeliverySchema), controller.reassign);

export default router;
