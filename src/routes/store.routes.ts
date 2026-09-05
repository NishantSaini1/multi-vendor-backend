import { Router } from 'express';
import * as controller from '../controllers/store.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
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
} from '../validators/store.validator';

const router = Router();

// Store has no login of its own (see Store.ts) — this module is admin-only,
// unlike the vendor/admin dual-actor pattern used for the Food catalog.
router.use(authenticateAdmin);

router.get('/', requirePermission(PERMISSIONS.STORE_VIEW), controller.list);
router.post(
  '/',
  requirePermission(PERMISSIONS.STORE_CREATE),
  validate(createStoreSchema),
  requireLocationAccess((req) => req.body?.locationId),
  controller.create,
);
router.get('/:id', requirePermission(PERMISSIONS.STORE_VIEW), validate(storeIdParamSchema), controller.getById);
router.patch('/:id', requirePermission(PERMISSIONS.STORE_UPDATE), validate(updateStoreSchema), controller.update);
router.delete('/:id', requirePermission(PERMISSIONS.STORE_DELETE), validate(storeIdParamSchema), controller.remove);
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.STORE_UPDATE),
  validate(updateStoreStatusSchema),
  controller.updateStatus,
);
router.get('/:id/dashboard', requirePermission(PERMISSIONS.STORE_VIEW), validate(storeIdParamSchema), controller.dashboard);
router.get('/:id/products', requirePermission(PERMISSIONS.STORE_VIEW), validate(storeIdParamSchema), controller.products);
router.get('/:id/inventory', requirePermission(PERMISSIONS.STORE_VIEW), validate(storeIdParamSchema), controller.inventory);

// /:id/orders and /:id/settlements are added once the Order and Settlement
// modules exist.

router.get(
  '/:storeId/documents',
  requirePermission(PERMISSIONS.STORE_VIEW),
  validate(storeIdOnlyParamSchema),
  controller.listDocuments,
);
router.post(
  '/:storeId/documents',
  requirePermission(PERMISSIONS.STORE_UPDATE),
  validate(createStoreDocumentSchema),
  controller.addDocument,
);
router.patch(
  '/:storeId/documents/:documentId',
  requirePermission(PERMISSIONS.STORE_UPDATE),
  validate(updateStoreDocumentSchema),
  controller.updateDocument,
);
router.delete(
  '/:storeId/documents/:documentId',
  requirePermission(PERMISSIONS.STORE_UPDATE),
  validate(storeDocumentParamsSchema),
  controller.deleteDocument,
);

export default router;
