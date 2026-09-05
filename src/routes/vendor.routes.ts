import { Router } from 'express';
import * as controller from '../controllers/vendor.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission, requireLocationAccess } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createVendorSchema,
  updateVendorSchema,
  vendorIdParamSchema,
  updateVendorStatusSchema,
  rejectVendorSchema,
  vendorIdOnlyParamSchema,
  createVendorDocumentSchema,
  vendorDocumentParamsSchema,
  updateVendorDocumentSchema,
} from '../validators/vendor.validator';

const router = Router();

// GET/PATCH /:id are shared with the Vendor App (a vendor viewing/editing
// their own profile — e.g. the open/closed toggle); ownership is enforced in
// vendor.service.ts. Every other route stays Admin-only.
const selfOrAdminAccess = authenticate('ADMIN', 'VENDOR');

router.get('/', authenticateAdmin, requirePermission(PERMISSIONS.VENDOR_VIEW), controller.list);
router.post(
  '/',
  authenticateAdmin,
  requirePermission(PERMISSIONS.VENDOR_CREATE),
  validate(createVendorSchema),
  requireLocationAccess((req) => req.body?.locationId),
  controller.create,
);
router.get('/:id', selfOrAdminAccess, requirePermission(PERMISSIONS.VENDOR_VIEW), validate(vendorIdParamSchema), controller.getById);
router.patch('/:id', selfOrAdminAccess, requirePermission(PERMISSIONS.VENDOR_UPDATE), validate(updateVendorSchema), controller.update);
router.delete('/:id', authenticateAdmin, requirePermission(PERMISSIONS.VENDOR_DELETE), validate(vendorIdParamSchema), controller.remove);
router.patch(
  '/:id/status',
  authenticateAdmin,
  requirePermission(PERMISSIONS.VENDOR_UPDATE),
  validate(updateVendorStatusSchema),
  controller.updateStatus,
);
router.post('/:id/approve', authenticateAdmin, requirePermission(PERMISSIONS.VENDOR_APPROVE), validate(vendorIdParamSchema), controller.approve);
router.post('/:id/reject', authenticateAdmin, requirePermission(PERMISSIONS.VENDOR_APPROVE), validate(rejectVendorSchema), controller.reject);
router.post('/:id/suspend', authenticateAdmin, requirePermission(PERMISSIONS.VENDOR_UPDATE), validate(vendorIdParamSchema), controller.suspend);
router.post('/:id/activate', authenticateAdmin, requirePermission(PERMISSIONS.VENDOR_UPDATE), validate(vendorIdParamSchema), controller.activate);
router.get('/:id/dashboard', authenticateAdmin, requirePermission(PERMISSIONS.VENDOR_VIEW), validate(vendorIdParamSchema), controller.dashboard);
router.get('/:id/products', authenticateAdmin, requirePermission(PERMISSIONS.VENDOR_VIEW), validate(vendorIdParamSchema), controller.products);

// /:id/orders, /:id/reviews, /:id/settlements are added once the Order, Review, and
// Settlement modules exist — they'd otherwise just return fake empty data.

router.get(
  '/:vendorId/documents',
  authenticateAdmin,
  requirePermission(PERMISSIONS.VENDOR_VIEW),
  validate(vendorIdOnlyParamSchema),
  controller.listDocuments,
);
router.post(
  '/:vendorId/documents',
  authenticateAdmin,
  requirePermission(PERMISSIONS.VENDOR_UPDATE),
  validate(createVendorDocumentSchema),
  controller.addDocument,
);
router.patch(
  '/:vendorId/documents/:documentId',
  authenticateAdmin,
  requirePermission(PERMISSIONS.VENDOR_UPDATE),
  validate(updateVendorDocumentSchema),
  controller.updateDocument,
);
router.delete(
  '/:vendorId/documents/:documentId',
  authenticateAdmin,
  requirePermission(PERMISSIONS.VENDOR_UPDATE),
  validate(vendorDocumentParamsSchema),
  controller.deleteDocument,
);

export default router;
