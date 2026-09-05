import { Router } from 'express';
import * as controller from '../controllers/deliveryPartner.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createDeliveryPartnerSchema,
  updateDeliveryPartnerSchema,
  deliveryPartnerIdParamSchema,
  updateDeliveryPartnerStatusSchema,
  rejectDeliveryPartnerSchema,
  updateAvailabilitySchema,
  updateLocationSchema,
  deliveryPartnerIdOnlyParamSchema,
  createDeliveryPartnerDocumentSchema,
  deliveryPartnerDocumentParamsSchema,
  updateDeliveryPartnerDocumentSchema,
} from '../validators/deliveryPartner.validator';
import { upsertVehicleSchema } from '../validators/deliveryPartnerVehicle.validator';

const router = Router();

const dualActor = authenticate('ADMIN', 'DELIVERY_PARTNER');

// --- Admin-only account management ---
router.get('/', authenticateAdmin, requirePermission(PERMISSIONS.DELIVERY_PARTNER_VIEW), controller.list);
router.post(
  '/',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_MANAGE),
  validate(createDeliveryPartnerSchema),
  controller.create,
);
router.patch(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_MANAGE),
  validate(updateDeliveryPartnerSchema),
  controller.update,
);
router.delete(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_MANAGE),
  validate(deliveryPartnerIdParamSchema),
  controller.remove,
);
router.patch(
  '/:id/status',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_MANAGE),
  validate(updateDeliveryPartnerStatusSchema),
  controller.updateStatus,
);
router.post(
  '/:id/approve',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_MANAGE),
  validate(deliveryPartnerIdParamSchema),
  controller.approve,
);
router.post(
  '/:id/reject',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_MANAGE),
  validate(rejectDeliveryPartnerSchema),
  controller.reject,
);
router.post(
  '/:id/suspend',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_MANAGE),
  validate(deliveryPartnerIdParamSchema),
  controller.suspend,
);
router.post(
  '/:id/activate',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_MANAGE),
  validate(deliveryPartnerIdParamSchema),
  controller.activate,
);

router.get(
  '/:deliveryPartnerId/documents',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_VIEW),
  validate(deliveryPartnerIdOnlyParamSchema),
  controller.listDocuments,
);
router.post(
  '/:deliveryPartnerId/documents',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_MANAGE),
  validate(createDeliveryPartnerDocumentSchema),
  controller.addDocument,
);
router.patch(
  '/:deliveryPartnerId/documents/:documentId',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_MANAGE),
  validate(updateDeliveryPartnerDocumentSchema),
  controller.updateDocument,
);
router.delete(
  '/:deliveryPartnerId/documents/:documentId',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_MANAGE),
  validate(deliveryPartnerDocumentParamsSchema),
  controller.deleteDocument,
);

// --- Dual-actor: the owning partner (self only) or a location-scoped admin ---
router.get('/:id', dualActor, requirePermission(PERMISSIONS.DELIVERY_PARTNER_VIEW), validate(deliveryPartnerIdParamSchema), controller.getById);
router.patch('/:id/availability', dualActor, validate(updateAvailabilitySchema), controller.updateAvailability);
router.post('/:id/location', dualActor, validate(updateLocationSchema), controller.updateLocation);
router.get('/:id/location', dualActor, validate(deliveryPartnerIdParamSchema), controller.getLocation);
router.get('/:id/vehicle', dualActor, validate(deliveryPartnerIdParamSchema), controller.getVehicle);
router.put('/:id/vehicle', dualActor, validate(upsertVehicleSchema), controller.upsertVehicle);

export default router;
