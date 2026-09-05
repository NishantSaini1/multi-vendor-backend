import { Router } from 'express';
import authRoutes from './auth.routes';
import locationRoutes from './location.routes';
import deliveryZoneRoutes from './deliveryZone.routes';
import serviceabilityRoutes from './serviceability.routes';
import vendorRoutes from './vendor.routes';
import foodCategoryRoutes from './foodCategory.routes';
import foodSubcategoryRoutes from './foodSubcategory.routes';
import foodProductRoutes from './foodProduct.routes';
import foodAddonRoutes from './foodAddon.routes';
import storeRoutes from './store.routes';
import instamartCategoryRoutes from './instamartCategory.routes';
import instamartSubcategoryRoutes from './instamartSubcategory.routes';
import instamartProductRoutes from './instamartProduct.routes';
import inventoryRoutes from './inventory.routes';
import customerRoutes from './customer.routes';
import deliveryPartnerRoutes from './deliveryPartner.routes';
import deliveryAssignmentRoutes from './deliveryAssignment.routes';
import orderRoutes from './order.routes';
import deliveryRoutes from './delivery.routes';
import paymentRoutes from './payment.routes';
import refundRoutes from './refund.routes';
import commissionRoutes from './commission.routes';
import settlementRoutes from './settlement.routes';
import couponRoutes from './coupon.routes';
import offerRoutes from './offer.routes';
import bannerRoutes from './banner.routes';
import reviewRoutes from './review.routes';
import notificationRoutes from './notification.routes';
import deliveryIssueRoutes from './deliveryIssue.routes';
import adminUserRoutes from './adminUser.routes';
import activityLogRoutes from './activityLog.routes';
import dashboardRoutes from './dashboard.routes';
import searchRoutes from './search.routes';
import uploadRoutes from './upload.routes';
import geocodingRoutes from './geocoding.routes';
import healthRoutes from './health.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/locations', locationRoutes);
router.use('/delivery-zones', deliveryZoneRoutes);
router.use('/serviceability', serviceabilityRoutes);
router.use('/vendors', vendorRoutes);
router.use('/food/categories', foodCategoryRoutes);
router.use('/food/subcategories', foodSubcategoryRoutes);
router.use('/food/products', foodProductRoutes);
router.use('/food/addons', foodAddonRoutes);
router.use('/stores', storeRoutes);
router.use('/instamart/categories', instamartCategoryRoutes);
router.use('/instamart/subcategories', instamartSubcategoryRoutes);
router.use('/instamart/products', instamartProductRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/customers', customerRoutes);
router.use('/delivery-partners', deliveryPartnerRoutes);
router.use('/delivery', deliveryAssignmentRoutes);
router.use('/orders', orderRoutes);
router.use('/deliveries', deliveryRoutes);
router.use('/payments', paymentRoutes);
router.use('/refunds', refundRoutes);
router.use('/commissions', commissionRoutes);
router.use('/settlements', settlementRoutes);
router.use('/coupons', couponRoutes);
router.use('/offers', offerRoutes);
router.use('/banners', bannerRoutes);
router.use('/reviews', reviewRoutes);
router.use('/notifications', notificationRoutes);
router.use('/delivery-issues', deliveryIssueRoutes);
router.use('/admin-users', adminUserRoutes);
router.use('/activity-logs', activityLogRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/search', searchRoutes);
router.use('/uploads', uploadRoutes);
router.use('/geocoding', geocodingRoutes);
router.use('/health', healthRoutes);

// Wallet is mounted per-customer at /customers/:customerId/wallet (see
// customer.routes.ts), not as its own top-level group. Background jobs
// (order timeout, daily settlement generation, notification retry) have no
// HTTP surface of their own — see src/jobs/index.ts.

// All 17 roadmap steps are built — see README.md's "Module build order"
// section for the full history and the judgment calls made along the way.

export default router;
