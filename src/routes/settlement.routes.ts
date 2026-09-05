import { Router } from 'express';
import * as controller from '../controllers/settlement.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  generateSettlementsSchema,
  settlementIdParamSchema,
  updateSettlementAdjustmentsSchema,
  paySettlementSchema,
  listSettlementsQuerySchema,
} from '../validators/settlement.validator';

const router = Router();

// Reads are dual-actor: self-scoped VENDOR/DELIVERY_PARTNER (their own
// settlements only — see settlementListFilter/assertSettlementAccess), or an
// ADMIN with FINANCE_VIEW, location-scoped. Store has no login of its own
// (per the established pattern), so STORE
// settlements are admin-view-only. Every write below is admin-only —
// generation, adjustments, and the process/pay lifecycle are finance
// operations no vendor or delivery partner can trigger themselves — so
// those routes authenticate separately rather than sharing the dual-actor
// gate (requirePermission no-ops for non-ADMIN actors, so a shared gate
// would let a vendor token reach them).
const dualActor = authenticate('ADMIN', 'VENDOR', 'DELIVERY_PARTNER');

router.post(
  '/generate',
  authenticateAdmin,
  requirePermission(PERMISSIONS.SETTLEMENT_PROCESS),
  validate(generateSettlementsSchema),
  controller.generate,
);

router.get('/', dualActor, requirePermission(PERMISSIONS.FINANCE_VIEW), validate(listSettlementsQuerySchema), controller.list);
router.get('/:id', dualActor, requirePermission(PERMISSIONS.FINANCE_VIEW), validate(settlementIdParamSchema), controller.getById);

router.patch(
  '/:id/adjustments',
  authenticateAdmin,
  requirePermission(PERMISSIONS.SETTLEMENT_PROCESS),
  validate(updateSettlementAdjustmentsSchema),
  controller.updateAdjustments,
);
router.post(
  '/:id/process',
  authenticateAdmin,
  requirePermission(PERMISSIONS.SETTLEMENT_PROCESS),
  validate(settlementIdParamSchema),
  controller.process,
);
router.post(
  '/:id/pay',
  authenticateAdmin,
  requirePermission(PERMISSIONS.SETTLEMENT_PAY),
  validate(paySettlementSchema),
  controller.pay,
);

export default router;
