import { Router } from 'express';
import * as controller from '../controllers/banner.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createBannerSchema,
  updateBannerSchema,
  updateBannerStatusSchema,
  bannerIdParamSchema,
  listBannersQuerySchema,
  activeBannersQuerySchema,
} from '../validators/banner.validator';

const router = Router();

// Public — used by the customer/vendor apps to render banner carousels, no
// auth required. Must be declared before the admin-only gate.
router.get('/active', validate(activeBannersQuerySchema), controller.active);

router.use(authenticateAdmin);

router.get('/', requirePermission(PERMISSIONS.BANNER_VIEW), validate(listBannersQuerySchema), controller.list);
router.post('/', requirePermission(PERMISSIONS.BANNER_MANAGE), validate(createBannerSchema), controller.create);
router.get('/:id', requirePermission(PERMISSIONS.BANNER_VIEW), validate(bannerIdParamSchema), controller.getById);
router.patch('/:id', requirePermission(PERMISSIONS.BANNER_MANAGE), validate(updateBannerSchema), controller.update);
router.delete('/:id', requirePermission(PERMISSIONS.BANNER_MANAGE), validate(bannerIdParamSchema), controller.remove);
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.BANNER_MANAGE),
  validate(updateBannerStatusSchema),
  controller.updateStatus,
);

export default router;
