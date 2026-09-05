import { Router } from 'express';
import * as controller from '../controllers/serviceability.controller';
import { validate } from '../middleware/validate.middleware';
import { checkServiceabilitySchema } from '../validators/serviceability.validator';

const router = Router();

// Public — used by the customer app before checkout, no auth required.
router.post('/check', validate(checkServiceabilitySchema), controller.check);

export default router;
