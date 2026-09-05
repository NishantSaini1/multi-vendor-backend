import { Router } from 'express';
import * as controller from '../controllers/deliveryAuth.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateDeliveryPartner } from '../middleware/auth.middleware';
import { loginRateLimiter } from '../middleware/rateLimiter.middleware';
import {
  deliveryLoginSchema,
  refreshTokenSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../validators/auth.validator';

const router = Router();

router.post('/login', loginRateLimiter, validate(deliveryLoginSchema), controller.login);
router.post('/refresh', validate(refreshTokenSchema), controller.refresh);
router.post('/logout', validate(refreshTokenSchema), controller.logout);
router.get('/me', authenticateDeliveryPartner, controller.me);
router.post('/change-password', authenticateDeliveryPartner, validate(changePasswordSchema), controller.changePassword);
router.post('/forgot-password', loginRateLimiter, validate(forgotPasswordSchema), controller.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), controller.resetPassword);
router.post('/logout-all', authenticateDeliveryPartner, controller.logoutAll);

export default router;
