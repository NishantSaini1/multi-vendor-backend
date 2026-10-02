import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as deliveryService from '../services/delivery.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req);

  const filter: Record<string, unknown> = {};
  if (user.userType === 'DELIVERY_PARTNER') {
    filter.deliveryPartnerId = user.userId;
  } else if (req.query.deliveryPartnerId) {
    filter.deliveryPartnerId = req.query.deliveryPartnerId;
  }
  if (req.query.status) filter.status = req.query.status;
  if (req.query.orderId) filter.orderId = req.query.orderId;

  const { items, total } = await deliveryService.listDeliveries(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const delivery = await deliveryService.getDeliveryById(req.params.id, requireUser(req));
  sendSuccess(res, delivery);
});

export const tracking = catchAsync(async (req: Request, res: Response) => {
  const data = await deliveryService.getDeliveryTracking(req.params.id, requireUser(req));
  sendSuccess(res, data);
});

export const paymentStatus = catchAsync(async (req: Request, res: Response) => {
  const data = await deliveryService.getDeliveryPaymentStatus(req.params.id, requireUser(req));
  sendSuccess(res, data);
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const delivery = await deliveryService.updateDeliveryStatus(req.params.id, req.body.status, requireUser(req), {
    cashCollected: req.body.cashCollected,
  });
  sendSuccess(res, delivery, 'Delivery status updated');
});

// GET — vendor or admin fetches the current pickup OTP to display in the vendor app.
export const getVendorOtp = catchAsync(async (req: Request, res: Response) => {
  const result = await deliveryService.getVendorOtp(req.params.id, requireUser(req));
  sendSuccess(res, result, 'Vendor OTP');
});

// POST — vendor generates (or regenerates) the pickup OTP.
export const generateVendorOtp = catchAsync(async (req: Request, res: Response) => {
  const result = await deliveryService.generateVendorOtp(req.params.id, requireUser(req));
  sendSuccess(res, result, 'Vendor OTP generated');
});

// GET — customer or admin fetches their delivery OTP to display in the customer app.
export const getCustomerOtp = catchAsync(async (req: Request, res: Response) => {
  const result = await deliveryService.getCustomerOtp(req.params.id, requireUser(req));
  sendSuccess(res, result, 'Customer OTP');
});

// POST — customer requests regeneration of their delivery OTP.
export const generateCustomerOtp = catchAsync(async (req: Request, res: Response) => {
  await deliveryService.generateCustomerOtp(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Customer OTP refreshed — check your app');
});

export const verifyPickup = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) throw ApiError.badRequest('Package image is required', 'IMAGE_REQUIRED');
  const { otp, latitude, longitude } = req.body;
  const delivery = await deliveryService.verifyPickup(req.params.id, {
    otp,
    imageBuffer: req.file.buffer,
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
  }, requireUser(req));
  sendSuccess(res, delivery, 'Pickup verified — status updated to PICKED_UP');
});

export const verifyDelivery = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) throw ApiError.badRequest('Delivery image is required', 'IMAGE_REQUIRED');
  const { otp, latitude, longitude, cashCollected } = req.body;
  const delivery = await deliveryService.verifyDelivery(req.params.id, {
    otp,
    imageBuffer: req.file.buffer,
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    cashCollected: cashCollected === 'true' || cashCollected === true,
  }, requireUser(req));
  sendSuccess(res, delivery, 'Delivery verified — order marked DELIVERED');
});
