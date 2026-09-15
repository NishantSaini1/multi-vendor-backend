import { Router } from 'express';
import * as controller from '../controllers/store.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission, requireLocationAccess } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createStoreSchema,
  updateStoreSchema,
  storeIdParamSchema,
  updateStoreStatusSchema,
  storeIdOnlyParamSchema,
  createStoreDocumentSchema,
  storeDocumentParamsSchema,
  updateStoreDocumentSchema,
  rejectStoreSchema,
} from '../validators/store.validator';

const router = Router();

// GET/PATCH /:id are shared with the Store's own login (a store viewing/
// editing its own profile); ownership is enforced in store.service.ts. Every
// other route (creation, deletion, dashboard/products/inventory, documents)
// stays Admin-only.
const selfOrAdminAccess = authenticate('ADMIN', 'STORE');
// Detail/products are additionally readable by the Customer App for store
// discovery — the controller strips store PII (manager name, phone, email)
// from CUSTOMER-facing responses. The list route has no STORE self-access
// case, so it's Admin + Customer only.
const selfOrAdminOrCustomerAccess = authenticate('ADMIN', 'STORE', 'CUSTOMER');
const listAccess = authenticate('ADMIN', 'CUSTOMER');

router.get('/', listAccess, requirePermission(PERMISSIONS.STORE_VIEW), controller.list);
router.post(
  '/',
  authenticateAdmin,
  requirePermission(PERMISSIONS.STORE_CREATE),
  validate(createStoreSchema),
  requireLocationAccess((req) => req.body?.locationId),
  controller.create,
);
router.get('/:id', selfOrAdminOrCustomerAccess, requirePermission(PERMISSIONS.STORE_VIEW), validate(storeIdParamSchema), controller.getById);
router.patch('/:id', selfOrAdminAccess, requirePermission(PERMISSIONS.STORE_UPDATE), validate(updateStoreSchema), controller.update);
router.delete('/:id', authenticateAdmin, requirePermission(PERMISSIONS.STORE_DELETE), validate(storeIdParamSchema), controller.remove);
router.patch(
  '/:id/status',
  authenticateAdmin,
  requirePermission(PERMISSIONS.STORE_UPDATE),
  validate(updateStoreStatusSchema),
  controller.updateStatus,
);
router.post(
  '/:id/approve',
  authenticateAdmin,
  requirePermission(PERMISSIONS.STORE_APPROVE),
  validate(storeIdParamSchema),
  controller.approve,
);
router.post(
  '/:id/reject',
  authenticateAdmin,
  requirePermission(PERMISSIONS.STORE_APPROVE),
  validate(rejectStoreSchema),
  controller.reject,
);
router.get('/:id/dashboard', selfOrAdminAccess, requirePermission(PERMISSIONS.STORE_VIEW), validate(storeIdParamSchema), controller.dashboard);
router.get('/:id/products', selfOrAdminOrCustomerAccess, requirePermission(PERMISSIONS.STORE_VIEW), validate(storeIdParamSchema), controller.products);
router.get('/:id/inventory', selfOrAdminAccess, requirePermission(PERMISSIONS.STORE_VIEW), validate(storeIdParamSchema), controller.inventory);

// /:id/orders and /:id/settlements are added once the Order and Settlement
// modules exist.

router.get(
  '/:storeId/documents',
  selfOrAdminAccess,
  requirePermission(PERMISSIONS.STORE_VIEW),
  validate(storeIdOnlyParamSchema),
  controller.listDocuments,
);
router.post(
  '/:storeId/documents',
  selfOrAdminAccess,
  requirePermission(PERMISSIONS.STORE_UPDATE),
  validate(createStoreDocumentSchema),
  controller.addDocument,
);
router.patch(
  '/:storeId/documents/:documentId',
  selfOrAdminAccess,
  requirePermission(PERMISSIONS.STORE_UPDATE),
  validate(updateStoreDocumentSchema),
  controller.updateDocument,
);
router.delete(
  '/:storeId/documents/:documentId',
  selfOrAdminAccess,
  requirePermission(PERMISSIONS.STORE_UPDATE),
  validate(storeDocumentParamsSchema),
  controller.deleteDocument,
);

export default router;
