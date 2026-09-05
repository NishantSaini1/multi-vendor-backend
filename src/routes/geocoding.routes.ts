import { Router } from 'express';
import * as controller from '../controllers/geocoding.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateAny } from '../middleware/auth.middleware';
import { geocodeSearchSchema, geocodeReverseSchema } from '../validators/geocoding.validator';

const router = Router();

// Authenticated (any actor type) rather than public — this proxies a
// third-party service (OpenStreetMap Nominatim) with its own usage policy;
// requiring auth plus this app's general rate limiter keeps volume
// reasonable rather than exposing an open geocoding proxy to the internet.
router.use(authenticateAny);

router.get('/search', validate(geocodeSearchSchema), controller.search);
router.get('/reverse', validate(geocodeReverseSchema), controller.reverse);

export default router;
