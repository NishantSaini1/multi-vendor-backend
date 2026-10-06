import { Router } from 'express';
import * as controller from '../controllers/deliveryPartnerSalary.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  partnerIdParamSchema,
  recordIdParamSchema,
  upsertSalaryConfigSchema,
  listSalaryConfigsQuerySchema,
  generateSalaryRecordsSchema,
  listSalaryRecordsQuerySchema,
  markSalaryPaidSchema,
} from '../validators/deliveryPartnerSalary.validator';

const router = Router();

// Read routes for salary records are dual-actor: delivery partners see their own
// records; admins see all within their location. All config routes and record
// write routes are admin-only (mirrors the settlement routes pattern).
const dualActor = authenticate('ADMIN', 'DELIVERY_PARTNER');

// ─── Salary Configs (admin-only) ─────────────────────────────────────────────
router.get(
  '/configs',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_SALARY_VIEW),
  validate(listSalaryConfigsQuerySchema),
  controller.listConfigs,
);
router.get(
  '/configs/:partnerId',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_SALARY_VIEW),
  validate(partnerIdParamSchema),
  controller.getConfig,
);
router.put(
  '/configs/:partnerId',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_SALARY_MANAGE),
  validate(upsertSalaryConfigSchema),
  controller.upsertConfig,
);
router.delete(
  '/configs/:partnerId',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_SALARY_MANAGE),
  validate(partnerIdParamSchema),
  controller.deleteConfig,
);

// ─── Salary Records ───────────────────────────────────────────────────────────

// Static/prefixed route must come before '/:id'.
router.post(
  '/records/generate',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_SALARY_MANAGE),
  validate(generateSalaryRecordsSchema),
  controller.generateRecords,
);
router.get(
  '/records',
  dualActor,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_SALARY_VIEW),
  validate(listSalaryRecordsQuerySchema),
  controller.listRecords,
);
router.get(
  '/records/:id',
  dualActor,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_SALARY_VIEW),
  validate(recordIdParamSchema),
  controller.getRecord,
);
router.patch(
  '/records/:id/pay',
  authenticateAdmin,
  requirePermission(PERMISSIONS.DELIVERY_PARTNER_SALARY_MANAGE),
  validate(markSalaryPaidSchema),
  controller.markPaid,
);

export default router;
