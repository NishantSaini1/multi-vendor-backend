import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { ApiError } from '../utils/ApiError';
import * as vendorCatalogAccessService from '../services/vendorCatalogAccess.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const items = await vendorCatalogAccessService.listVendorCatalogAccess(req.params.vendorId, requireUser(req));
  sendSuccess(res, items);
});

export const listMine = catchAsync(async (req: Request, res: Response) => {
  const items = await vendorCatalogAccessService.listMyVendorCatalogAccess(requireUser(req));
  sendSuccess(res, items);
});

export const grant = catchAsync(async (req: Request, res: Response) => {
  requireUser(req);
  const access = await vendorCatalogAccessService.grantVendorCatalogAccess(req.params.vendorId, req.body);
  sendSuccess(res, access, 'Vendor catalog access granted successfully', 201);
});

export const revoke = catchAsync(async (req: Request, res: Response) => {
  requireUser(req);
  await vendorCatalogAccessService.revokeVendorCatalogAccess(req.params.vendorId, req.params.accessId);
  sendSuccess(res, null, 'Vendor catalog access revoked successfully');
});
