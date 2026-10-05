import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { ApiError } from '../utils/ApiError';
import { findAvailablePartners } from '../services/deliveryAssignment.service';
import { assignDeliveryPartner, reassignDeliveryPartner } from '../services/delivery.service';
import * as capacityService from '../services/deliveryCapacity.service';

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

// Live partner counts and whether customers can order right now in a location.
export const capacityStatus = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await capacityService.getCapacityStatus(String(req.query.locationId), requireUser(req)));
});

// The capacity setting for one location (or the global one when no locationId).
export const capacitySettings = catchAsync(async (req: Request, res: Response) => {
  const locationId = req.query.locationId ? String(req.query.locationId) : null;
  sendSuccess(res, await capacityService.getCapacitySettings(locationId, requireUser(req)));
});

export const updateCapacitySettings = catchAsync(async (req: Request, res: Response) => {
  const { locationId, ...input } = req.body;
  const result = await capacityService.updateCapacitySettings(locationId ?? null, input, requireUser(req));
  sendSuccess(res, result, 'Delivery capacity settings updated');
});

export const assign = catchAsync(async (req: Request, res: Response) => {
  const delivery = await assignDeliveryPartner(req.body.orderId, req.body.deliveryPartnerId, requireUser(req));
  sendSuccess(res, delivery, 'Delivery partner assigned successfully', 201);
});

export const reassign = catchAsync(async (req: Request, res: Response) => {
  const delivery = await reassignDeliveryPartner(req.body.orderId, req.body.deliveryPartnerId, req.body.reason, requireUser(req));
  sendSuccess(res, delivery, 'Delivery partner reassigned successfully');
});
