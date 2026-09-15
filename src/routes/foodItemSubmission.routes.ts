import { Router } from 'express';
import * as controller from '../controllers/foodItemSubmission.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticate, authenticateAdmin, authenticateVendor } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { PERMISSIONS } from '../constants/permissions';
import {
  createFoodItemSubmissionSchema,
  updateFoodItemSubmissionSchema,
  foodItemSubmissionIdParamSchema,
  rejectFoodItemSubmissionSchema,
} from '../validators/foodItemSubmission.validator';

const router = Router();

// A vendor's "this item doesn't exist in the catalog yet" proposal (spec
// §12) — a vendor creates and reads their own; an admin reviews everyone's.
const readAccess = authenticate('ADMIN', 'VENDOR');

router.get('/', readAccess, requirePermission(PERMISSIONS.FOOD_ITEM_SUBMISSION_VIEW), controller.list);
router.post('/', authenticateVendor, validate(createFoodItemSubmissionSchema), controller.create);
router.get(
  '/:id',
  readAccess,
  requirePermission(PERMISSIONS.FOOD_ITEM_SUBMISSION_VIEW),
  validate(foodItemSubmissionIdParamSchema),
  controller.getById,
);
router.patch(
  '/:id',
  authenticateAdmin,
  requirePermission(PERMISSIONS.FOOD_ITEM_SUBMISSION_REVIEW),
  validate(updateFoodItemSubmissionSchema),
  controller.update,
);
router.post(
  '/:id/approve',
  authenticateAdmin,
  requirePermission(PERMISSIONS.FOOD_ITEM_SUBMISSION_REVIEW),
  validate(foodItemSubmissionIdParamSchema),
  controller.approve,
);
router.post(
  '/:id/reject',
  authenticateAdmin,
  requirePermission(PERMISSIONS.FOOD_ITEM_SUBMISSION_REVIEW),
  validate(rejectFoodItemSubmissionSchema),
  controller.reject,
);

export default router;
