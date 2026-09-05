import { Router } from 'express';
import * as controller from '../controllers/search.controller';
import { validate } from '../middleware/validate.middleware';
import { searchQuerySchema } from '../validators/search.validator';

const router = Router();

// Public — core browsing, same as GET /offers/active and GET /banners/active.
router.get('/', validate(searchQuerySchema), controller.search);

export default router;
