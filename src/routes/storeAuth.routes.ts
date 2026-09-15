import { Router } from 'express';
import * as controller from '../controllers/storeAuth.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateStore } from '../middleware/auth.middleware';
import { loginRateLimiter } from '../middleware/rateLimiter.middleware';
import {
  vendorLoginSchema,
  refreshTokenSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../validators/auth.validator';

const router = Router();

// Reuses vendorLoginSchema (identifier + password) — same shape a store login needs.
router.post('/login', loginRateLimiter, validate(vendorLoginSchema), controller.login);
router.post('/refresh', validate(refreshTokenSchema), controller.refresh);
router.post('/logout', validate(refreshTokenSchema), controller.logout);
router.get('/me', authenticateStore, controller.me);
router.post('/change-password', authenticateStore, validate(changePasswordSchema), controller.changePassword);
router.post('/forgot-password', loginRateLimiter, validate(forgotPasswordSchema), controller.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), controller.resetPassword);
router.post('/logout-all', authenticateStore, controller.logoutAll);

export default router;
