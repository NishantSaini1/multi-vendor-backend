import { Router } from 'express';
import * as controller from '../controllers/pricing.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  pricingIdParamSchema,
  updatePricingSchema,
  pricingPreviewQuerySchema,
  financialReportQuerySchema,
} from '../validators/pricing.validator';

const router = Router();

// Vendors and stores choose their own pricing model (COMMISSION vs MARKUP);
// admins can set it for any vendor/store in their location scope and are the
// only ones who can set the rates (commission %, default markup). Ownership
// for the non-admin actor is enforced in pricing.service.ts.
const vendorOrAdmin = authenticate('ADMIN', 'VENDOR');
const storeOrAdmin = authenticate('ADMIN', 'STORE');

router.get('/vendors/:id', vendorOrAdmin, requirePermission(PERMISSIONS.VENDOR_VIEW), validate(pricingIdParamSchema), controller.getVendorPricing);
router.put('/vendors/:id', vendorOrAdmin, requirePermission(PERMISSIONS.VENDOR_UPDATE), validate(updatePricingSchema), controller.updateVendorPricing);
router.get('/stores/:id', storeOrAdmin, requirePermission(PERMISSIONS.STORE_VIEW), validate(pricingIdParamSchema), controller.getStorePricing);
router.put('/stores/:id', storeOrAdmin, requirePermission(PERMISSIONS.STORE_UPDATE), validate(updatePricingSchema), controller.updateStorePricing);

router.get('/preview', authenticate('ADMIN', 'VENDOR', 'STORE'), validate(pricingPreviewQuerySchema), controller.preview);

// Platform financial reports — Food and Instamart separately, and per seller.
router.get(
  '/reports/financial',
  authenticateAdmin,
  requirePermission(PERMISSIONS.COMMISSION_VIEW),
  validate(financialReportQuerySchema),
  controller.financialReportHandler,
);
router.get(
  '/reports/sellers',
  authenticateAdmin,
  requirePermission(PERMISSIONS.COMMISSION_VIEW),
  validate(financialReportQuerySchema),
  controller.sellerFinancialsHandler,
);

export default router;
