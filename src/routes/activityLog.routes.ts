import { Router } from 'express';
import * as controller from '../controllers/activityLog.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { listActivityLogsQuerySchema } from '../validators/activityLog.validator';

const router = Router();

router.use(authenticateAdmin);
router.get('/', requirePermission(PERMISSIONS.ACTIVITY_LOG_VIEW), validate(listActivityLogsQuerySchema), controller.list);

export default router;
