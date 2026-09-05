import { Router } from 'express';
import * as controller from '../controllers/upload.controller';
import { authenticateAny } from '../middleware/auth.middleware';
import { uploadImage } from '../middleware/upload.middleware';

const router = Router();

// Any authenticated actor type — this is a stateless media utility (upload
// an image, get back a URL, PATCH it onto whatever profile/product/banner
// needs it elsewhere), not an owned resource of its own; there's no
// "uploads" model tracking who uploaded what; see README for the trade-off.
router.use(authenticateAny);

router.post('/', uploadImage, controller.create);
router.delete('/', controller.remove);

export default router;
