import { Router } from 'express';
import * as controller from '../controllers/customerAuth.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateCustomer } from '../middleware/auth.middleware';
import { otpSendRateLimiter, otpVerifyRateLimiter } from '../middleware/rateLimiter.middleware';
import {
  sendOtpSchema,
  verifyOtpSchema,
  resendOtpSchema,
  refreshTokenSchema,
  changePhoneSchema,
  sessionParamsSchema,
} from '../validators/auth.validator';

const router = Router();

router.post('/send-otp', otpSendRateLimiter, validate(sendOtpSchema), controller.sendOtp);
router.post('/verify-otp', otpVerifyRateLimiter, validate(verifyOtpSchema), controller.verifyOtp);
router.post('/resend-otp', otpSendRateLimiter, validate(resendOtpSchema), controller.resendOtp);
router.post('/refresh', validate(refreshTokenSchema), controller.refresh);
router.post('/logout', validate(refreshTokenSchema), controller.logout);
router.get('/me', authenticateCustomer, controller.me);

router.post('/change-phone', authenticateCustomer, otpVerifyRateLimiter, validate(changePhoneSchema), controller.changePhone);
router.post('/logout-all', authenticateCustomer, controller.logoutAll);
router.get('/sessions', authenticateCustomer, controller.sessions);
router.delete('/sessions/:sessionId', authenticateCustomer, validate(sessionParamsSchema), controller.revokeSession);

export default router;
