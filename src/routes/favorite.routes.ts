import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware';
import { authenticate } from '../middleware/auth.middleware';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { ApiError } from '../utils/ApiError';
import { FAVORITE_TYPES } from '../models/CustomerFavorite';
import * as favoriteService from '../services/favorite.service';

const objectId = z.string().length(24);
const typeEnum = z.enum(Object.values(FAVORITE_TYPES) as [string, ...string[]]);
const favoriteBody = z.object({
  type: typeEnum,
  targetId: objectId,
  name: z.string().trim().min(1).max(200),
  image: z.string().url().optional(),
  meta: z
    .object({
      businessType: z.enum(['FOOD', 'INSTAMART']).optional(),
      vendorId: objectId.optional(),
      storeId: objectId.optional(),
      sellerName: z.string().max(200).optional(),
    })
    .optional(),
});

const addSchema = z.object({ body: favoriteBody });
const removeSchema = z.object({ params: z.object({ type: typeEnum, targetId: objectId }) });
const importSchema = z.object({ body: z.object({ items: z.array(favoriteBody).max(200) }) });

function userId(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user.userId;
}

// Customer favourites (restaurants, stores, products), synced across devices.
const router = Router();
router.use(authenticate('CUSTOMER'));

router.get(
  '/',
  catchAsync(async (req: Request, res: Response) => {
    sendSuccess(res, await favoriteService.listFavorites(userId(req)));
  }),
);

router.post(
  '/',
  validate(addSchema),
  catchAsync(async (req: Request, res: Response) => {
    sendSuccess(res, await favoriteService.addFavorite(userId(req), req.body), 'Added to favourites', 201);
  }),
);

router.post(
  '/import',
  validate(importSchema),
  catchAsync(async (req: Request, res: Response) => {
    sendSuccess(res, await favoriteService.importFavorites(userId(req), req.body.items));
  }),
);

router.delete(
  '/:type/:targetId',
  validate(removeSchema),
  catchAsync(async (req: Request, res: Response) => {
    await favoriteService.removeFavorite(userId(req), req.params.type, req.params.targetId);
    sendSuccess(res, null, 'Removed from favourites');
  }),
);

export default router;
