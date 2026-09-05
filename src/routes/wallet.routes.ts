import { Router } from 'express';
import * as controller from '../controllers/wallet.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { walletCustomerParamSchema, listWalletTransactionsQuerySchema, adjustWalletSchema } from '../validators/wallet.validator';

// mergeParams so :customerId from the parent /customers router is visible here.
const router = Router({ mergeParams: true });

// Reads are dual-actor (self-scoped CUSTOMER, or an ADMIN with WALLET_VIEW —
// FINANCE_ADMIN, or SUPPORT_ADMIN for read-only support access), same shape
// as CustomerAddress: requirePermission no-ops for the non-ADMIN actor, and
// ownership is enforced in wallet.service for the CUSTOMER actor. /adjust is
// admin-only — it must NOT go through the same dual-actor gate, since
// requirePermission's no-op for non-ADMIN would let a customer token credit
// or debit their own balance directly.
const dualActor = authenticate('CUSTOMER', 'ADMIN');

router.get('/', dualActor, requirePermission(PERMISSIONS.WALLET_VIEW), validate(walletCustomerParamSchema), controller.getWallet);
router.get(
  '/transactions',
  dualActor,
  requirePermission(PERMISSIONS.WALLET_VIEW),
  validate(listWalletTransactionsQuerySchema),
  controller.listTransactions,
);
router.post(
  '/adjust',
  authenticateAdmin,
  requirePermission(PERMISSIONS.WALLET_MANAGE),
  validate(adjustWalletSchema),
  controller.adjust,
);

export default router;
