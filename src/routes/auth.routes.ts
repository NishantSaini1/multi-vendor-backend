import { Router } from 'express';
import customerAuthRoutes from './customerAuth.routes';
import vendorAuthRoutes from './vendorAuth.routes';
import storeAuthRoutes from './storeAuth.routes';
import deliveryAuthRoutes from './deliveryAuth.routes';
import adminAuthRoutes from './adminAuth.routes';

const router = Router();

router.use('/customer', customerAuthRoutes);
router.use('/vendor', vendorAuthRoutes);
router.use('/store', storeAuthRoutes);
router.use('/delivery', deliveryAuthRoutes);
router.use('/admin', adminAuthRoutes);

export default router;
