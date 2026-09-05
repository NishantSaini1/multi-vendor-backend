import { Router } from 'express';
import * as controller from '../controllers/deliveryIssue.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createDeliveryIssueSchema,
  deliveryIssueIdParamSchema,
  updateDeliveryIssueStatusSchema,
  listDeliveryIssuesQuerySchema,
} from '../validators/deliveryIssue.validator';

const router = Router();

// Raising an issue is for the three parties who actually experience a
// delivery — no ADMIN branch here (see deliveryIssue.service).
router.post(
  '/',
  authenticate('CUSTOMER', 'VENDOR', 'DELIVERY_PARTNER'),
  validate(createDeliveryIssueSchema),
  controller.create,
);

// Reads are dual-actor: any of the three parties on the delivery, or an
// ADMIN with DELIVERY_ISSUE_VIEW (location-scoped) — requirePermission
// no-ops for the non-ADMIN actors, ownership/membership is enforced in
// deliveryIssue.service.
const dualActor = authenticate('CUSTOMER', 'VENDOR', 'DELIVERY_PARTNER', 'ADMIN');
router.get('/', dualActor, requirePermission(PERMISSIONS.DELIVERY_ISSUE_VIEW), validate(listDeliveryIssuesQuerySchema), controller.list);
router.get('/:id', dualActor, requirePermission(PERMISSIONS.DELIVERY_ISSUE_VIEW), validate(deliveryIssueIdParamSchema), controller.getById);

// Resolving/closing an issue is an ops/support action — admin-only.
router.patch(
  '/:id/status',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_ISSUE_MANAGE),
  validate(updateDeliveryIssueStatusSchema),
  controller.updateStatus,
);

export default router;
