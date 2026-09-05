import { Router } from 'express';
import * as controller from '../controllers/customer.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  updateCustomerSchema,
  customerIdParamSchema,
  updateCustomerStatusSchema,
} from '../validators/customer.validator';
import customerAddressRoutes from './customerAddress.routes';
import walletRoutes from './wallet.routes';

const router = Router();

// Customer address management and wallet (self-scoped for CUSTOMER,
// support-scoped for ADMIN) are mounted before the admin-only gate below
// since they accept both actor types.
router.use('/:customerId/addresses', customerAddressRoutes);
router.use('/:customerId/wallet', walletRoutes);

router.use(authenticateAdmin);

router.get('/', requirePermission(PERMISSIONS.CUSTOMER_VIEW), controller.list);
router.get('/:id', requirePermission(PERMISSIONS.CUSTOMER_VIEW), validate(customerIdParamSchema), controller.getById);
router.patch('/:id', requirePermission(PERMISSIONS.CUSTOMER_UPDATE), validate(updateCustomerSchema), controller.update);
router.delete('/:id', requirePermission(PERMISSIONS.CUSTOMER_DELETE), validate(customerIdParamSchema), controller.remove);
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.CUSTOMER_UPDATE),
  validate(updateCustomerStatusSchema),
  controller.updateStatus,
);
router.get('/:id/dashboard', requirePermission(PERMISSIONS.CUSTOMER_VIEW), validate(customerIdParamSchema), controller.dashboard);

// /:id/orders and /:id/reviews are added once the Order-list-by-customer and
// Review modules exist (Wallet is already mounted above; Refunds live at the
// top-level /refunds router alongside /payments, matching /orders).

export default router;
