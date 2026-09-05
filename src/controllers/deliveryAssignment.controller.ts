import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { ApiError } from '../utils/ApiError';
import { findAvailablePartners } from '../services/deliveryAssignment.service';
import { assignDeliveryPartner, reassignDeliveryPartner } from '../services/delivery.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const availablePartners = catchAsync(async (req: Request, res: Response) => {
  const { locationId, latitude, longitude, radiusKm } = req.query;
  const partners = await findAvailablePartners(
    String(locationId),
    parseFloat(String(latitude)),
    parseFloat(String(longitude)),
    radiusKm ? parseFloat(String(radiusKm)) : undefined,
    requireUser(req),
  );
  sendSuccess(res, partners);
});

export const assign = catchAsync(async (req: Request, res: Response) => {
  const delivery = await assignDeliveryPartner(req.body.orderId, req.body.deliveryPartnerId, requireUser(req));
  sendSuccess(res, delivery, 'Delivery partner assigned successfully', 201);
});

export const reassign = catchAsync(async (req: Request, res: Response) => {
  const delivery = await reassignDeliveryPartner(req.body.orderId, req.body.deliveryPartnerId, req.body.reason, requireUser(req));
  sendSuccess(res, delivery, 'Delivery partner reassigned successfully');
});
