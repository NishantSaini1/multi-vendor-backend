import { Router } from 'express';
import * as controller from '../controllers/customerAddress.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createCustomerAddressSchema,
  updateCustomerAddressSchema,
  customerAddressListParamsSchema,
  customerAddressParamsSchema,
} from '../validators/customerAddress.validator';

// mergeParams so :customerId from the parent /customers router is visible here.
const router = Router({ mergeParams: true });

// Self-scoped for the owning CUSTOMER; an ADMIN with CUSTOMER_UPDATE can also
// manage addresses on a customer's behalf for support purposes.
router.use(authenticate('CUSTOMER', 'ADMIN'));

router.get('/', requirePermission(PERMISSIONS.CUSTOMER_VIEW), validate(customerAddressListParamsSchema), controller.list);
router.post(
  '/',
  requirePermission(PERMISSIONS.CUSTOMER_UPDATE),
  validate(createCustomerAddressSchema),
  controller.create,
);
router.get(
  '/:addressId',
  requirePermission(PERMISSIONS.CUSTOMER_VIEW),
  validate(customerAddressParamsSchema),
  controller.getById,
);
router.patch(
  '/:addressId',
  requirePermission(PERMISSIONS.CUSTOMER_UPDATE),
  validate(updateCustomerAddressSchema),
  controller.update,
);
router.delete(
  '/:addressId',
  requirePermission(PERMISSIONS.CUSTOMER_UPDATE),
  validate(customerAddressParamsSchema),
  controller.remove,
);
router.patch(
  '/:addressId/default',
  requirePermission(PERMISSIONS.CUSTOMER_UPDATE),
  validate(customerAddressParamsSchema),
  controller.setDefault,
);

export default router;
