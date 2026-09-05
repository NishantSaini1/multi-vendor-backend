import { Router } from 'express';
import * as controller from '../controllers/offer.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createOfferSchema,
  updateOfferSchema,
  updateOfferStatusSchema,
  offerIdParamSchema,
  listOffersQuerySchema,
  activeOffersQuerySchema,
} from '../validators/offer.validator';

const router = Router();

// Public — used by the customer/vendor apps to render "what's on offer"
// content, no auth required. Must be declared before the admin-only gate.
router.get('/active', validate(activeOffersQuerySchema), controller.active);

router.use(authenticateAdmin);

router.get('/', requirePermission(PERMISSIONS.OFFER_VIEW), validate(listOffersQuerySchema), controller.list);
router.post('/', requirePermission(PERMISSIONS.OFFER_MANAGE), validate(createOfferSchema), controller.create);
router.get('/:id', requirePermission(PERMISSIONS.OFFER_VIEW), validate(offerIdParamSchema), controller.getById);
router.patch('/:id', requirePermission(PERMISSIONS.OFFER_MANAGE), validate(updateOfferSchema), controller.update);
router.delete('/:id', requirePermission(PERMISSIONS.OFFER_MANAGE), validate(offerIdParamSchema), controller.remove);
router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.OFFER_MANAGE),
  validate(updateOfferStatusSchema),
  controller.updateStatus,
);

export default router;
