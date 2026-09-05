import { Router } from 'express';
import * as controller from '../controllers/dashboard.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import { dashboardOverviewQuerySchema, ordersTrendQuerySchema } from '../validators/dashboard.validator';

const router = Router();

router.use(authenticateAdmin);

router.get('/overview', requirePermission(PERMISSIONS.DASHBOARD_VIEW), validate(dashboardOverviewQuerySchema), controller.overview);
router.get('/orders-trend', requirePermission(PERMISSIONS.DASHBOARD_VIEW), validate(ordersTrendQuerySchema), controller.ordersTrend);

export default router;
