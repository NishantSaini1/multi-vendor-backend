import { Router } from 'express';
import * as controller from '../controllers/adminAuth.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { loginRateLimiter } from '../middleware/rateLimiter.middleware';
import {
  adminLoginSchema,
  refreshTokenSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../validators/auth.validator';

const router = Router();

router.post('/login', loginRateLimiter, validate(adminLoginSchema), controller.login);
router.post('/refresh', validate(refreshTokenSchema), controller.refresh);
router.post('/logout', validate(refreshTokenSchema), controller.logout);
router.get('/me', authenticateAdmin, controller.me);
router.post('/change-password', authenticateAdmin, validate(changePasswordSchema), controller.changePassword);
router.post('/forgot-password', loginRateLimiter, validate(forgotPasswordSchema), controller.forgotPassword);
router.post('/reset-password', validate(resetPasswordSchema), controller.resetPassword);
router.post('/logout-all', authenticateAdmin, controller.logoutAll);

export default router;
