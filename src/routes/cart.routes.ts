import { Router } from 'express';
import * as controller from '../controllers/cart.controller';
import { validate } from '../middleware/validate.middleware';
import { authenticateCustomer } from '../middleware/auth.middleware';
import { addCartItemSchema, updateCartItemSchema, cartItemIdParamSchema } from '../validators/cart.validator';

const router = Router();

// The backend Cart (Stage 3) — a lightweight, additive server-side cart so
// the single-vendor rule and price-snapshot behavior live in one place (see
// cart.service.ts), on top of the existing inline-items order-creation path
// (kept working, unchanged, for callers that don't use a cart — see
// order.service.ts's createOrder). Customer-only: a cart is always the
// authenticated customer's own.
router.use(authenticateCustomer);

router.get('/', controller.getCart);
router.post('/items', validate(addCartItemSchema), controller.addItem);
router.patch('/items/:id', validate(updateCartItemSchema), controller.updateItemQuantity);
router.delete('/items/:id', validate(cartItemIdParamSchema), controller.removeItem);
router.delete('/', controller.clearCart);

export default router;
