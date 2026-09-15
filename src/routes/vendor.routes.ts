import { Router } from 'express';
import * as controller from '../controllers/vendor.controller';
import * as vendorCatalogAccessController from '../controllers/vendorCatalogAccess.controller';
import vendorFoodItemRoutes from './vendorFoodItem.routes';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin, authenticateVendor } from '../middleware/auth.middleware';
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
import {
  grantVendorCatalogAccessSchema,
  vendorCatalogAccessParamsSchema,
} from '../validators/vendorCatalogAccess.validator';

const router = Router();

// GET/PATCH /:id are shared with the Vendor App (a vendor viewing/editing
// their own profile — e.g. the open/closed toggle); ownership is enforced in
// vendor.service.ts. Every other route stays Admin-only.
const selfOrAdminAccess = authenticate('ADMIN', 'VENDOR');
// Detail/products are additionally readable by the Customer App for
// restaurant discovery — the controller strips vendor PII (owner name,
// phone, email, GST/FSSAI/PAN) from CUSTOMER-facing responses. The list
// route has no VENDOR self-access case (a vendor never needs to list every
// other vendor), so it's Admin + Customer only.
const selfOrAdminOrCustomerAccess = authenticate('ADMIN', 'VENDOR', 'CUSTOMER');
const listAccess = authenticate('ADMIN', 'CUSTOMER');

router.get('/', listAccess, requirePermission(PERMISSIONS.VENDOR_VIEW), controller.list);
router.post(
  '/',
  authenticateAdmin,
  requirePermission(PERMISSIONS.VENDOR_CREATE),
  validate(createVendorSchema),
  requireLocationAccess((req) => req.body?.locationId),
  controller.create,
);
router.get('/:id', selfOrAdminOrCustomerAccess, requirePermission(PERMISSIONS.VENDOR_VIEW), validate(vendorIdParamSchema), controller.getById);
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
router.get('/:id/products', selfOrAdminOrCustomerAccess, requirePermission(PERMISSIONS.VENDOR_VIEW), validate(vendorIdParamSchema), controller.products);

// /:id/orders, /:id/reviews, /:id/settlements are added once the Order, Review, and
// Settlement modules exist — they'd otherwise just return fake empty data.

// The vendor-facing "what can I add" picker (a logged-in vendor's own
// catalog-access grants). Registered before /:vendorId/catalog-access below
// so "me" is never matched as a vendorId route param.
router.get(
  '/me/catalog-access',
  authenticateVendor,
  requirePermission(PERMISSIONS.VENDOR_CATALOG_ACCESS_VIEW),
  vendorCatalogAccessController.listMine,
);

// Admin-controlled allow-list of which global Food categories/subcategories a
// vendor may use for its menu — list is admin-or-the-vendor-themself
// (ownership enforced in vendorCatalogAccess.service.ts), grant/revoke stay
// Admin-only.
router.get(
  '/:vendorId/catalog-access',
  authenticate('ADMIN', 'VENDOR'),
  requirePermission(PERMISSIONS.VENDOR_CATALOG_ACCESS_VIEW),
  validate(vendorIdOnlyParamSchema),
  vendorCatalogAccessController.list,
);
router.post(
  '/:vendorId/catalog-access',
  authenticateAdmin,
  requirePermission(PERMISSIONS.VENDOR_CATALOG_ACCESS_MANAGE),
  validate(grantVendorCatalogAccessSchema),
  vendorCatalogAccessController.grant,
);
router.delete(
  '/:vendorId/catalog-access/:accessId',
  authenticateAdmin,
  requirePermission(PERMISSIONS.VENDOR_CATALOG_ACCESS_MANAGE),
  validate(vendorCatalogAccessParamsSchema),
  vendorCatalogAccessController.revoke,
);

// A vendor's own menu (price/availability/variants/modifier groups) — see
// vendorFoodItem.routes.ts. A vendor may only manage their own; an admin
// follows ordinary location scoping (enforced in vendorFoodItem.service.ts).
router.use('/:vendorId/food-items', vendorFoodItemRoutes);

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
