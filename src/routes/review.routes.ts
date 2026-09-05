import { Router } from 'express';
import * as controller from '../controllers/review.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateOptional, authenticateAdmin } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createReviewSchema,
  updateReviewSchema,
  updateReviewStatusSchema,
  reviewIdParamSchema,
  listReviewsQuerySchema,
} from '../validators/review.validator';

const router = Router();

// Browsing is public — VISIBLE reviews for anyone; a logged-in customer also
// sees their own HIDDEN ones, and an admin with REVIEW_VIEW sees everything
// (see review.service.reviewListFilter/getReviewById). authenticateOptional
// never rejects, it just attaches req.user when a valid token is present.
const optionalAuth = authenticateOptional();
router.get('/', optionalAuth, validate(listReviewsQuerySchema), controller.list);
router.get('/:id', optionalAuth, validate(reviewIdParamSchema), controller.getById);

router.post('/', authenticate('CUSTOMER'), validate(createReviewSchema), controller.create);
router.patch('/:id', authenticate('CUSTOMER'), validate(updateReviewSchema), controller.update);

// Delete is dual-actor: the review's own author, or an admin with
// REVIEW_MODERATE — requirePermission no-ops for the CUSTOMER actor
// (ownership enforced in review.service), and gates the ADMIN actor.
router.delete(
  '/:id',
  authenticate('CUSTOMER', 'ADMIN'),
  requirePermission(PERMISSIONS.REVIEW_MODERATE),
  validate(reviewIdParamSchema),
  controller.remove,
);

router.patch(
  '/:id/status',
  authenticateAdmin,
  requirePermission(PERMISSIONS.REVIEW_MODERATE),
  validate(updateReviewStatusSchema),
  controller.updateStatus,
);

export default router;
