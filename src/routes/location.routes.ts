import { Router } from 'express';
import * as controller from '../controllers/location.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission, requireLocationAccess } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createLocationSchema,
  updateLocationSchema,
  idParamSchema,
  updateLocationStatusSchema,
  updateLocationSettingsSchema,
} from '../validators/location.validator';

const router = Router();

router.use(authenticateAdmin);

router.get('/', requirePermission(PERMISSIONS.LOCATION_VIEW), controller.list);
router.post('/', requirePermission(PERMISSIONS.LOCATION_CREATE), validate(createLocationSchema), controller.create);
router.get(
  '/:id',
  requirePermission(PERMISSIONS.LOCATION_VIEW),
  validate(idParamSchema),
  requireLocationAccess((req) => req.params.id),
  controller.getById,
);
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.LOCATION_UPDATE),
  validate(updateLocationSchema),
  requireLocationAccess((req) => req.params.id),
  controller.update,
);
router.delete(
  '/:id',
  requirePermission(PERMISSIONS.LOCATION_DELETE),
  validate(idParamSchema),
  requireLocationAccess((req) => req.params.id),
  controller.remove,
);
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.LOCATION_UPDATE),
  validate(updateLocationStatusSchema),
  requireLocationAccess((req) => req.params.id),
  controller.updateStatus,
);
router.get(
  '/:id/dashboard',
  requirePermission(PERMISSIONS.LOCATION_VIEW),
  validate(idParamSchema),
  requireLocationAccess((req) => req.params.id),
  controller.dashboard,
);
router.get(
  '/:id/settings',
  requirePermission(PERMISSIONS.LOCATION_VIEW),
  validate(idParamSchema),
  requireLocationAccess((req) => req.params.id),
  controller.getSettings,
);
router.patch(
  '/:id/settings',
  requirePermission(PERMISSIONS.LOCATION_UPDATE),
  validate(updateLocationSettingsSchema),
  requireLocationAccess((req) => req.params.id),
  controller.updateSettings,
);

export default router;
