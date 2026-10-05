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
  profitReportQuerySchema,
  sellerEarningsQuerySchema,
} from '../validators/pricing.validator';

const router = Router();

// Vendors and stores choose their own pricing model (COMMISSION vs MARKUP);
// admins can set it for any vendor/store in their location scope and are the
// only ones who can set the rates (commission %, default markup). Ownership
// for the non-admin actor is enforced in pricing.service.ts.
const vendorOrAdmin = authenticate('ADMIN', 'VENDOR');
const storeOrAdmin = authenticate('ADMIN', 'STORE');

router.get('/vendors/:id', vendorOrAdmin, requirePermission(PERMISSIONS.VENDOR_VIEW), validate(pricingIdParamSchema), controller.getVendorPricing);
// PUT and PATCH both: the body is a partial update, and the admin panel sends
// PATCH while the vendor/store apps send PUT.
router.put('/vendors/:id', vendorOrAdmin, requirePermission(PERMISSIONS.VENDOR_UPDATE), validate(updatePricingSchema), controller.updateVendorPricing);
router.patch('/vendors/:id', vendorOrAdmin, requirePermission(PERMISSIONS.VENDOR_UPDATE), validate(updatePricingSchema), controller.updateVendorPricing);
router.get('/stores/:id', storeOrAdmin, requirePermission(PERMISSIONS.STORE_VIEW), validate(pricingIdParamSchema), controller.getStorePricing);
router.put('/stores/:id', storeOrAdmin, requirePermission(PERMISSIONS.STORE_UPDATE), validate(updatePricingSchema), controller.updateStorePricing);
router.patch('/stores/:id', storeOrAdmin, requirePermission(PERMISSIONS.STORE_UPDATE), validate(updatePricingSchema), controller.updateStorePricing);

router.get('/preview', authenticate('ADMIN', 'VENDOR', 'STORE'), validate(pricingPreviewQuerySchema), controller.preview);

// A vendor's/store's own earnings by product and order (never the platform's profit).
const sellerOnly = authenticate('VENDOR', 'STORE');
router.get('/my/summary', sellerOnly, validate(sellerEarningsQuerySchema), controller.myEarningsSummary);
router.get('/my/products', sellerOnly, validate(sellerEarningsQuerySchema), controller.myProductEarnings);
router.get('/my/orders', sellerOnly, validate(sellerEarningsQuerySchema), controller.myOrderEarnings);

// Platform financial reports — Food and Instamart separately, and per seller.
router.get(
  '/reports/financial',
  authenticateAdmin,
  requirePermission(PERMISSIONS.COMMISSION_VIEW),
  validate(financialReportQuerySchema),
  controller.financialReportHandler,
);
router.get('/reports/sellers', authenticateAdmin, requirePermission(PERMISSIONS.COMMISSION_VIEW), validate(profitReportQuerySchema), controller.sellerFinancialsHandler);
router.get('/reports/products', authenticateAdmin, requirePermission(PERMISSIONS.COMMISSION_VIEW), validate(profitReportQuerySchema), controller.productFinancialsHandler);
router.get('/reports/orders', authenticateAdmin, requirePermission(PERMISSIONS.COMMISSION_VIEW), validate(profitReportQuerySchema), controller.orderFinancialsHandler);

export default router;
