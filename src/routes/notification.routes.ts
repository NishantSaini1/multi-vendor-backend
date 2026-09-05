import { Router } from 'express';
import * as controller from '../controllers/notification.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAny } from '../middleware/auth.middleware';
import {
  registerDeviceSchema,
  deviceIdParamSchema,
  notificationIdParamSchema,
  listNotificationsQuerySchema,
} from '../validators/notification.validator';

const router = Router();

// Any authenticated actor type (CUSTOMER/VENDOR/DELIVERY_PARTNER/ADMIN) —
// device registration and the in-app inbox are per-account, not
// role-specific, and every service that calls notification.service.notify()
// targets whichever actor type actually owns the event (a customer for
// order updates, a vendor/delivery partner for a completed settlement, ...).
router.use(authenticateAny);

router.post('/register-device', validate(registerDeviceSchema), controller.registerDevice);
router.delete('/device/:id', validate(deviceIdParamSchema), controller.unregisterDevice);

router.get('/', validate(listNotificationsQuerySchema), controller.list);
router.get('/unread-count', controller.unreadCount);
router.patch('/read-all', controller.markAllRead);
router.patch('/:id/read', validate(notificationIdParamSchema), controller.markRead);
router.delete('/:id', validate(notificationIdParamSchema), controller.remove);

export default router;
