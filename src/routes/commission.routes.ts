import { Router } from 'express';
import * as controller from '../controllers/commission.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createCommissionSchema,
  updateCommissionSchema,
  updateCommissionStatusSchema,
  commissionIdParamSchema,
  listCommissionsQuerySchema,
} from '../validators/commission.validator';

const router = Router();

router.use(authenticateAdmin);

router.get('/', requirePermission(PERMISSIONS.COMMISSION_VIEW), validate(listCommissionsQuerySchema), controller.list);
router.post('/', requirePermission(PERMISSIONS.COMMISSION_MANAGE), validate(createCommissionSchema), controller.create);
router.get('/:id', requirePermission(PERMISSIONS.COMMISSION_VIEW), validate(commissionIdParamSchema), controller.getById);
router.patch('/:id', requirePermission(PERMISSIONS.COMMISSION_MANAGE), validate(updateCommissionSchema), controller.update);
router.delete('/:id', requirePermission(PERMISSIONS.COMMISSION_MANAGE), validate(commissionIdParamSchema), controller.remove);
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.COMMISSION_MANAGE),
  validate(updateCommissionStatusSchema),
  controller.updateStatus,
);

export default router;
