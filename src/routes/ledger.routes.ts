import { Router } from 'express';
import * as controller from '../controllers/ledger.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { listTransactionsQuerySchema } from '../validators/ledger.validator';

const router = Router();

// Admin-only, read-only — the financial ledger is written exclusively by
// ledger.service.ts's recordTransaction from other services (payment, order,
// delivery, refund, settlement); there is no create/update/delete surface
// here on purpose.
router.get('/', authenticateAdmin, requirePermission(PERMISSIONS.LEDGER_VIEW), validate(listTransactionsQuerySchema), controller.list);

export default router;
