import { Router } from 'express';
import * as controller from '../controllers/delivery.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { uploadImage } from '../middleware/upload.middleware';
import {
  deliveryIdParamSchema,
  updateDeliveryStatusSchema,
  listDeliveriesQuerySchema,
  verifyPickupSchema,
  verifyDeliverySchema,
} from '../validators/delivery.validator';

const router = Router();

const anyDeliveryActor = authenticate('ADMIN', 'DELIVERY_PARTNER', 'CUSTOMER', 'VENDOR');
const operatorActor = authenticate('ADMIN', 'DELIVERY_PARTNER');
const vendorOrAdmin = authenticate('ADMIN', 'VENDOR');
const customerOrAdmin = authenticate('ADMIN', 'CUSTOMER');

router.get('/', operatorActor, requirePermission(PERMISSIONS.DELIVERY_VIEW), validate(listDeliveriesQuerySchema), controller.list);
router.get('/:id', anyDeliveryActor, requirePermission(PERMISSIONS.DELIVERY_VIEW), validate(deliveryIdParamSchema), controller.getById);
router.get('/:id/tracking', anyDeliveryActor, requirePermission(PERMISSIONS.DELIVERY_VIEW), validate(deliveryIdParamSchema), controller.tracking);
router.get('/:id/payment', anyDeliveryActor, requirePermission(PERMISSIONS.DELIVERY_VIEW), validate(deliveryIdParamSchema), controller.paymentStatus);

// Regular status progression (ARRIVED_AT_VENDOR, OUT_FOR_DELIVERY, ARRIVED_AT_CUSTOMER, CANCELLED, FAILED).
// PICKED_UP and DELIVERED are intentionally excluded — they go through verify-pickup / verify-delivery.
router.patch(
  '/:id/status',
  operatorActor,
  requirePermission(PERMISSIONS.DELIVERY_ASSIGN),
  validate(updateDeliveryStatusSchema),
  controller.updateStatus,
);

// Vendor fetches the current pickup OTP to display in their app (order details screen).
router.get(
  '/:id/vendor-otp',
  vendorOrAdmin,
  requirePermission(PERMISSIONS.DELIVERY_VIEW),
  validate(deliveryIdParamSchema),
  controller.getVendorOtp,
);

// Vendor generates (or regenerates) the pickup OTP (e.g. first time or if partner needs a refresh).
router.post(
  '/:id/vendor-otp',
  vendorOrAdmin,
  requirePermission(PERMISSIONS.DELIVERY_VIEW),
  validate(deliveryIdParamSchema),
  controller.generateVendorOtp,
);

// Customer fetches their delivery OTP from the app (auto-generated when order goes OUT_FOR_DELIVERY).
router.get(
  '/:id/customer-otp',
  customerOrAdmin,
  requirePermission(PERMISSIONS.DELIVERY_VIEW),
  validate(deliveryIdParamSchema),
  controller.getCustomerOtp,
);

// Customer regenerates their delivery OTP on demand.
router.post(
  '/:id/customer-otp',
  customerOrAdmin,
  requirePermission(PERMISSIONS.DELIVERY_VIEW),
  validate(deliveryIdParamSchema),
  controller.generateCustomerOtp,
);

// Partner verifies vendor OTP + captures package image → PICKED_UP.
// Accepts multipart/form-data: fields {otp, latitude, longitude} + file field "image".
router.post(
  '/:id/verify-pickup',
  operatorActor,
  requirePermission(PERMISSIONS.DELIVERY_ASSIGN),
  uploadImage,
  validate(verifyPickupSchema),
  controller.verifyPickup,
);

// Partner verifies customer OTP + captures delivery image → DELIVERED.
// Accepts multipart/form-data: fields {otp, latitude, longitude, cashCollected?} + file field "image".
router.post(
  '/:id/verify-delivery',
  operatorActor,
  requirePermission(PERMISSIONS.DELIVERY_ASSIGN),
  uploadImage,
  validate(verifyDeliverySchema),
  controller.verifyDelivery,
);

export default router;
