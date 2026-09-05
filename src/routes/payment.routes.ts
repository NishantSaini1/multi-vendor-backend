import { Router } from 'express';
import * as controller from '../controllers/payment.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { createRazorpayOrderSchema, verifyPaymentSchema, paymentIdParamSchema, listPaymentsQuerySchema } from '../validators/payment.validator';

const router = Router();

// Public — Razorpay calls this directly, authenticated by HMAC signature
// (verified in payment.service against the raw request body), not a JWT.
router.post('/webhook', controller.webhook);

const customerOnly = authenticate('CUSTOMER');
router.post('/razorpay-order', customerOnly, validate(createRazorpayOrderSchema), controller.createRazorpayOrder);
router.post('/verify', customerOnly, validate(verifyPaymentSchema), controller.verify);

// Dual-actor reads: self-scoped CUSTOMER, or an ADMIN with PAYMENT_VIEW
// (FINANCE_ADMIN, or SUPPORT_ADMIN read-only) — requirePermission no-ops for
// the non-ADMIN actor, ownership is enforced in payment.service.
const dualActor = authenticate('CUSTOMER', 'ADMIN');
router.get('/', dualActor, requirePermission(PERMISSIONS.PAYMENT_VIEW), validate(listPaymentsQuerySchema), controller.list);
router.get('/:id', dualActor, requirePermission(PERMISSIONS.PAYMENT_VIEW), validate(paymentIdParamSchema), controller.getById);

export default router;
