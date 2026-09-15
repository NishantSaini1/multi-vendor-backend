import { Router } from 'express';
import * as controller from '../controllers/instamartGlobalProduct.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createInstamartGlobalProductSchema,
  updateInstamartGlobalProductSchema,
  instamartGlobalProductIdParamSchema,
  updateInstamartGlobalProductStatusSchema,
  rejectInstamartGlobalProductSchema,
} from '../validators/instamartGlobalProduct.validator';

const router = Router();

// Read access is shared with Admin, Store (to search/pick a product to list
// against — Option A of product creation) and Customer (product detail
// pages). Creation/deletion/approval stay Admin-only; a store proposes a new
// product through POST /instamart/products { newProduct } instead (see
// instamartProduct.service.ts), which auto-approves — approve/reject here
// exist for a product an admin has separately marked PENDING. PATCH /:id is
// additionally open to a STORE — instamartGlobalProduct.service.ts's
// updateInstamartGlobalProduct restricts that to a product the store itself
// submitted, and only while no other store has listed it yet.
const readAccess = authenticate('ADMIN', 'STORE', 'CUSTOMER');
const writeAccess = authenticate('ADMIN');
const updateAccess = authenticate('ADMIN', 'STORE');

router.get('/', readAccess, requirePermission(PERMISSIONS.INSTAMART_GLOBAL_PRODUCT_VIEW), controller.list);
router.post(
  '/',
  writeAccess,
  requirePermission(PERMISSIONS.INSTAMART_GLOBAL_PRODUCT_MANAGE),
  validate(createInstamartGlobalProductSchema),
  controller.create,
);
router.get(
  '/:id',
  readAccess,
  requirePermission(PERMISSIONS.INSTAMART_GLOBAL_PRODUCT_VIEW),
  validate(instamartGlobalProductIdParamSchema),
  controller.getById,
);
router.patch(
  '/:id',
  updateAccess,
  requirePermission(PERMISSIONS.INSTAMART_GLOBAL_PRODUCT_MANAGE),
  validate(updateInstamartGlobalProductSchema),
  controller.update,
);
router.delete(
  '/:id',
  writeAccess,
  requirePermission(PERMISSIONS.INSTAMART_GLOBAL_PRODUCT_MANAGE),
  validate(instamartGlobalProductIdParamSchema),
  controller.remove,
);
router.patch(
  '/:id/status',
  writeAccess,
  requirePermission(PERMISSIONS.INSTAMART_GLOBAL_PRODUCT_MANAGE),
  validate(updateInstamartGlobalProductStatusSchema),
  controller.updateStatus,
);
router.post(
  '/:id/approve',
  writeAccess,
  requirePermission(PERMISSIONS.INSTAMART_GLOBAL_PRODUCT_APPROVE),
  validate(instamartGlobalProductIdParamSchema),
  controller.approve,
);
router.post(
  '/:id/reject',
  writeAccess,
  requirePermission(PERMISSIONS.INSTAMART_GLOBAL_PRODUCT_APPROVE),
  validate(rejectInstamartGlobalProductSchema),
  controller.reject,
);

export default router;
