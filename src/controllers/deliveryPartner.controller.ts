import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import { locationScopeFilter } from '../middleware/rbac.middleware';
import * as deliveryPartnerService from '../services/deliveryPartner.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req, { name: 1 });

  const filter: Record<string, unknown> = { ...locationScopeFilter(user) };
  if (req.query.locationId) filter.locationId = req.query.locationId;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.availability) filter.availability = req.query.availability;

  const { items, total } = await deliveryPartnerService.listDeliveryPartners(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const partner = await deliveryPartnerService.createDeliveryPartner(req.body);
  sendSuccess(res, partner, 'Delivery partner created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const partner = await deliveryPartnerService.getDeliveryPartnerById(req.params.id, requireUser(req));
  sendSuccess(res, partner);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const partner = await deliveryPartnerService.updateDeliveryPartner(req.params.id, req.body, requireUser(req));
  sendSuccess(res, partner, 'Delivery partner updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await deliveryPartnerService.deleteDeliveryPartner(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Delivery partner deleted successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const partner = await deliveryPartnerService.updateDeliveryPartnerStatus(req.params.id, req.body.status, requireUser(req));
  sendSuccess(res, partner, 'Delivery partner status updated');
});

export const approve = catchAsync(async (req: Request, res: Response) => {
  const partner = await deliveryPartnerService.approveDeliveryPartner(req.params.id, requireUser(req));
  sendSuccess(res, partner, 'Delivery partner approved successfully');
});

export const reject = catchAsync(async (req: Request, res: Response) => {
  const result = await deliveryPartnerService.rejectDeliveryPartner(req.params.id, req.body.reason, requireUser(req));
  sendSuccess(res, result.partner, 'Delivery partner rejected');
});

export const suspend = catchAsync(async (req: Request, res: Response) => {
  const partner = await deliveryPartnerService.suspendDeliveryPartner(req.params.id, requireUser(req));
  sendSuccess(res, partner, 'Delivery partner suspended');
});

export const activate = catchAsync(async (req: Request, res: Response) => {
  const partner = await deliveryPartnerService.activateDeliveryPartner(req.params.id, requireUser(req));
  sendSuccess(res, partner, 'Delivery partner activated');
});

export const updateAvailability = catchAsync(async (req: Request, res: Response) => {
  const partner = await deliveryPartnerService.updateAvailability(req.params.id, req.body.availability, requireUser(req));
  sendSuccess(res, partner, 'Availability updated');
});

export const updateLocation = catchAsync(async (req: Request, res: Response) => {
  const partner = await deliveryPartnerService.updateDeliveryPartnerLocation(
    req.params.id,
    req.body.latitude,
    req.body.longitude,
    requireUser(req),
  );
  sendSuccess(res, partner, 'Location updated');
});

export const getLocation = catchAsync(async (req: Request, res: Response) => {
  const location = await deliveryPartnerService.getDeliveryPartnerLocation(req.params.id, requireUser(req));
  sendSuccess(res, location);
});

export const getVehicle = catchAsync(async (req: Request, res: Response) => {
  const vehicle = await deliveryPartnerService.getDeliveryPartnerVehicle(req.params.id, requireUser(req));
  sendSuccess(res, vehicle);
});

export const upsertVehicle = catchAsync(async (req: Request, res: Response) => {
  const vehicle = await deliveryPartnerService.upsertDeliveryPartnerVehicle(req.params.id, req.body, requireUser(req));
  sendSuccess(res, vehicle, 'Vehicle saved successfully');
});

export const listDocuments = catchAsync(async (req: Request, res: Response) => {
  const documents = await deliveryPartnerService.listDeliveryPartnerDocuments(req.params.deliveryPartnerId, requireUser(req));
  sendSuccess(res, documents);
});

export const addDocument = catchAsync(async (req: Request, res: Response) => {
  const document = await deliveryPartnerService.addDeliveryPartnerDocument(
    req.params.deliveryPartnerId,
    req.body,
    requireUser(req),
  );
  sendSuccess(res, document, 'Document added successfully', 201);
});

export const updateDocument = catchAsync(async (req: Request, res: Response) => {
  const document = await deliveryPartnerService.updateDeliveryPartnerDocument(
    req.params.deliveryPartnerId,
    req.params.documentId,
    req.body,
    requireUser(req),
  );
  sendSuccess(res, document, 'Document updated successfully');
});

export const deleteDocument = catchAsync(async (req: Request, res: Response) => {
  await deliveryPartnerService.deleteDeliveryPartnerDocument(req.params.deliveryPartnerId, req.params.documentId, requireUser(req));
  sendSuccess(res, null, 'Document deleted successfully');
});
