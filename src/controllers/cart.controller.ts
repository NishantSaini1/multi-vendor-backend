import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { ApiError } from '../utils/ApiError';
import * as cartService from '../services/cart.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const getCart = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const { cart, items, subtotal } = await cartService.getCart(user.userId);
  sendSuccess(res, { ...cart.toObject(), items, subtotal });
});

export const addItem = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const item = await cartService.addItem(user.userId, req.body);
  sendSuccess(res, item, 'Item added to cart successfully', 201);
});

export const updateItemQuantity = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const item = await cartService.updateItemQuantity(user.userId, req.params.id, req.body.quantity);
  sendSuccess(res, item, 'Cart item updated successfully');
});

export const removeItem = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  await cartService.removeItem(user.userId, req.params.id);
  sendSuccess(res, null, 'Cart item removed successfully');
});

export const clearCart = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  await cartService.clearCart(user.userId);
  sendSuccess(res, null, 'Cart cleared successfully');
});
