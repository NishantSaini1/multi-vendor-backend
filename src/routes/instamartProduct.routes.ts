import { Router } from 'express';
import * as controller from '../controllers/instamartProduct.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createInstamartProductSchema,
  updateInstamartProductSchema,
  instamartProductIdParamSchema,
  updateInstamartProductStatusSchema,
} from '../validators/instamartProduct.validator';

const router = Router();

router.use(authenticateAdmin);

router.get('/', requirePermission(PERMISSIONS.INSTAMART_PRODUCT_VIEW), controller.list);
router.post(
  '/',
  requirePermission(PERMISSIONS.INSTAMART_PRODUCT_MANAGE),
  validate(createInstamartProductSchema),
  controller.create,
);
router.get(
  '/:id',
  requirePermission(PERMISSIONS.INSTAMART_PRODUCT_VIEW),
  validate(instamartProductIdParamSchema),
  controller.getById,
);
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.INSTAMART_PRODUCT_MANAGE),
  validate(updateInstamartProductSchema),
  controller.update,
);
router.delete(
  '/:id',
  requirePermission(PERMISSIONS.INSTAMART_PRODUCT_MANAGE),
  validate(instamartProductIdParamSchema),
  controller.remove,
);
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.INSTAMART_PRODUCT_MANAGE),
  validate(updateInstamartProductStatusSchema),
  controller.updateStatus,
);

export default router;
