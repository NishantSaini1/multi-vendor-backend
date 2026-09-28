import { Router } from 'express';
import * as controller from '../controllers/coupon.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createCouponSchema,
  updateCouponSchema,
  updateCouponStatusSchema,
  couponIdParamSchema,
  listCouponsQuerySchema,
  listActiveCouponsQuerySchema,
  previewCouponSchema,
} from '../validators/coupon.validator';

const router = Router();

// Customer-facing "browse applicable coupons" — registered before the
// admin-only gate below, since it's the one read customers themselves are
// allowed to make.
router.get(
  '/active',
  authenticate('CUSTOMER'),
  validate(listActiveCouponsQuerySchema),
  controller.listActive,
);

// Read-only check of a code against the customer's current cart — returns
// the discount it would give, or the same error POST /orders would throw.
// Shares coupon.service's evaluateCoupon with order creation, so the money
// math still lives in one place; it never consumes a use.
router.post('/preview', authenticate('CUSTOMER'), validate(previewCouponSchema), controller.preview);

// Management surface: ADMIN (gated by COUPON_* permissions) manages every
// coupon; a VENDOR/STORE manages only its own, locked to itself — see
// coupon.service / utils/promotionOwnership.ts (requirePermission is a no-op
// for non-admin actors). Actually applying a coupon (incrementing usedCount)
// happens as part of POST /orders itself — see order.service.createOrder.
router.use(authenticate('ADMIN', 'VENDOR', 'STORE'));

router.get('/', requirePermission(PERMISSIONS.COUPON_VIEW), validate(listCouponsQuerySchema), controller.list);
router.post('/', requirePermission(PERMISSIONS.COUPON_MANAGE), validate(createCouponSchema), controller.create);
router.get('/:id', requirePermission(PERMISSIONS.COUPON_VIEW), validate(couponIdParamSchema), controller.getById);
router.patch('/:id', requirePermission(PERMISSIONS.COUPON_MANAGE), validate(updateCouponSchema), controller.update);
router.delete('/:id', requirePermission(PERMISSIONS.COUPON_MANAGE), validate(couponIdParamSchema), controller.remove);
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.COUPON_MANAGE),
  validate(updateCouponStatusSchema),
  controller.updateStatus,
);

export default router;
