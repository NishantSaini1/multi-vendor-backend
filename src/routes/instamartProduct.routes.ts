import { Router } from 'express';
import * as controller from '../controllers/instamartProduct.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createInstamartProductSchema,
  updateInstamartProductSchema,
  instamartProductIdParamSchema,
  updateInstamartProductStatusSchema,
  createInstamartVariantSchema,
  updateInstamartVariantSchema,
  instamartVariantParamsSchema,
  instamartProductVariantsListSchema,
} from '../validators/instamartProduct.validator';

const router = Router();

// Read access is shared with the Admin Panel, the Store App, and the
// Customer App (public product browsing); write access stays limited to
// Admin + Store, with ownership enforced in the service layer (see
// instamartProduct.service.ts / assertOwnerOrLocationAccess).
const readAccess = authenticate('ADMIN', 'STORE', 'CUSTOMER');
const writeAccess = authenticate('ADMIN', 'STORE');

router.get('/', readAccess, requirePermission(PERMISSIONS.INSTAMART_PRODUCT_VIEW), controller.list);
router.post(
  '/',
  writeAccess,
  requirePermission(PERMISSIONS.INSTAMART_PRODUCT_MANAGE),
  validate(createInstamartProductSchema),
  controller.create,
);
router.get(
  '/:id',
  readAccess,
  requirePermission(PERMISSIONS.INSTAMART_PRODUCT_VIEW),
  validate(instamartProductIdParamSchema),
  controller.getById,
);
router.patch(
  '/:id',
  writeAccess,
  requirePermission(PERMISSIONS.INSTAMART_PRODUCT_MANAGE),
  validate(updateInstamartProductSchema),
  controller.update,
);
router.delete(
  '/:id',
  writeAccess,
  requirePermission(PERMISSIONS.INSTAMART_PRODUCT_MANAGE),
  validate(instamartProductIdParamSchema),
  controller.remove,
);
router.patch(
  '/:id/status',
  writeAccess,
  requirePermission(PERMISSIONS.INSTAMART_PRODUCT_MANAGE),
  validate(updateInstamartProductStatusSchema),
  controller.updateStatus,
);

router.get(
  '/:productId/variants',
  readAccess,
  requirePermission(PERMISSIONS.INSTAMART_PRODUCT_VIEW),
  validate(instamartProductVariantsListSchema),
  controller.listVariants,
);
router.post(
  '/:productId/variants',
  writeAccess,
  requirePermission(PERMISSIONS.INSTAMART_PRODUCT_MANAGE),
  validate(createInstamartVariantSchema),
  controller.createVariant,
);
router.patch(
  '/:productId/variants/:variantId',
  writeAccess,
  requirePermission(PERMISSIONS.INSTAMART_PRODUCT_MANAGE),
  validate(updateInstamartVariantSchema),
  controller.updateVariant,
);
router.delete(
  '/:productId/variants/:variantId',
  writeAccess,
  requirePermission(PERMISSIONS.INSTAMART_PRODUCT_MANAGE),
  validate(instamartVariantParamsSchema),
  controller.deleteVariant,
);

export default router;
