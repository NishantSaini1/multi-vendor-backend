import { Router } from 'express';
import * as controller from '../controllers/coupon.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createCouponSchema,
  updateCouponSchema,
  updateCouponStatusSchema,
  couponIdParamSchema,
  listCouponsQuerySchema,
} from '../validators/coupon.validator';

const router = Router();

// Admin-only management surface. Applying a coupon to an order (validating
// eligibility, computing the discount, incrementing usedCount) happens as
// part of POST /orders itself — see order.service.createOrder — not through
// a route here, so the same money math never lives in two places.
router.use(authenticateAdmin);

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
