import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { ApiError } from '../utils/ApiError';
import * as customerAddressService from '../services/customerAddress.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const addresses = await customerAddressService.listCustomerAddresses(req.params.customerId, requireUser(req));
  sendSuccess(res, addresses);
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const address = await customerAddressService.createCustomerAddress(req.params.customerId, req.body, requireUser(req));
  sendSuccess(res, address, 'Address added successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const address = await customerAddressService.getCustomerAddressById(
    req.params.customerId,
    req.params.addressId,
    requireUser(req),
  );
  sendSuccess(res, address);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const address = await customerAddressService.updateCustomerAddress(
    req.params.customerId,
    req.params.addressId,
    req.body,
    requireUser(req),
  );
  sendSuccess(res, address, 'Address updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await customerAddressService.deleteCustomerAddress(req.params.customerId, req.params.addressId, requireUser(req));
  sendSuccess(res, null, 'Address deleted successfully');
});

export const setDefault = catchAsync(async (req: Request, res: Response) => {
  const address = await customerAddressService.setDefaultCustomerAddress(
    req.params.customerId,
    req.params.addressId,
    requireUser(req),
  );
  sendSuccess(res, address, 'Default address updated');
});
