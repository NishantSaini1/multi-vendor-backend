import { Router } from 'express';
import * as controller from '../controllers/refund.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { createRefundSchema, refundIdParamSchema, listRefundsQuerySchema } from '../validators/refund.validator';

const router = Router();

// Manual refunds are admin-initiated only (REFUND_PROCESS — FINANCE_ADMIN).
// Cancelling a PAID order triggers an automatic refund on its own (see
// order.service's cancelOrder); this endpoint is for everything else —
// disputes, partial goodwill refunds, retrying a failed auto-refund.
router.post('/', authenticateAdmin, requirePermission(PERMISSIONS.REFUND_PROCESS), validate(createRefundSchema), controller.create);

// Dual-actor reads: self-scoped CUSTOMER, or an ADMIN with REFUND_VIEW
// (FINANCE_ADMIN, or SUPPORT_ADMIN read-only) — requirePermission no-ops for
// the non-ADMIN actor, ownership is enforced in refund.service.
const dualActor = authenticate('CUSTOMER', 'ADMIN');
router.get('/', dualActor, requirePermission(PERMISSIONS.REFUND_VIEW), validate(listRefundsQuerySchema), controller.list);
router.get('/:id', dualActor, requirePermission(PERMISSIONS.REFUND_VIEW), validate(refundIdParamSchema), controller.getById);

export default router;
