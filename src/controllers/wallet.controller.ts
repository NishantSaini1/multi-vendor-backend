import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as walletService from '../services/wallet.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const getWallet = catchAsync(async (req: Request, res: Response) => {
  const wallet = await walletService.getWalletForCustomer(req.params.customerId, requireUser(req));
  sendSuccess(res, wallet);
});

export const listTransactions = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const { items, total } = await walletService.listWalletTransactions(req.params.customerId, requireUser(req), pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const adjust = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const wallet = await walletService.adminAdjustWallet(req.params.customerId, req.body.amount, req.body.type, req.body.note, user.userId);
  sendSuccess(res, wallet, 'Wallet adjusted successfully');
});
