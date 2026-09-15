import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import { locationScopeFilter } from '../middleware/rbac.middleware';
import { STORE_STATUS } from '../constants/enums';
import * as storeService from '../services/store.service';
import { IStore } from '../models/Store';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

// The Store document carries operator PII (manager name, phone, email) that
// the Admin Panel and Store App need but a customer browsing stores never
// should see — trim the response down to the public "store card / store
// detail" fields for CUSTOMER callers.
function toCustomerStoreView(store: IStore) {
  return {
    id: store._id,
    locationId: store.locationId,
    deliveryZoneId: store.deliveryZoneId,
    storeTypeIds: store.storeTypeIds,
    name: store.name,
    logo: store.logo,
    address: store.address,
    latitude: store.latitude,
    longitude: store.longitude,
    status: store.status,
    openingTime: store.openingTime,
    closingTime: store.closingTime,
    rating: store.rating,
    ratingCount: store.ratingCount,
    createdAt: store.createdAt,
  };
}

function serializeForUser(store: IStore, userType: string) {
  return userType === 'CUSTOMER' ? toCustomerStoreView(store) : store;
}

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req, { name: 1 });
  const isCustomer = user.userType === 'CUSTOMER';

  const filter: Record<string, unknown> = { ...locationScopeFilter(user) };
  if (req.query.locationId) filter.locationId = req.query.locationId;
  // Zone -> Store: an app resolves the caller's zone via /serviceability
  // first, then browses only that zone's stores with this filter.
  if (req.query.deliveryZoneId) filter.deliveryZoneId = req.query.deliveryZoneId;
  if (req.query.storeTypeId) filter.storeTypeIds = req.query.storeTypeId;
  if (isCustomer) {
    // Customers only ever browse live stores.
    filter.status = STORE_STATUS.ACTIVE;
  } else if (req.query.status) {
    filter.status = req.query.status;
  }
  if (req.query.search) filter.name = { $regex: String(req.query.search), $options: 'i' };

  const { items, total } = await storeService.listStores(filter, pagination);
  const data = isCustomer ? items.map(toCustomerStoreView) : items;
  sendSuccess(res, data, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const store = await storeService.createStore(req.body);
  sendSuccess(res, store, 'Store created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const store = await storeService.getStoreById(req.params.id, user);
  sendSuccess(res, serializeForUser(store, user.userType));
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const store = await storeService.updateStore(req.params.id, req.body, requireUser(req));
  sendSuccess(res, store, 'Store updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await storeService.deleteStore(req.params.id, requireUser(req));
  sendSuccess(res, null, 'Store deleted successfully');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const store = await storeService.updateStoreStatus(req.params.id, req.body.status, requireUser(req));
  sendSuccess(res, store, 'Store status updated');
});

export const approve = catchAsync(async (req: Request, res: Response) => {
  const store = await storeService.approveStore(req.params.id, requireUser(req));
  sendSuccess(res, store, 'Store approved successfully');
});

export const reject = catchAsync(async (req: Request, res: Response) => {
  const result = await storeService.rejectStore(req.params.id, req.body.reason, requireUser(req));
  sendSuccess(res, result, 'Store rejected');
});

export const dashboard = catchAsync(async (req: Request, res: Response) => {
  const data = await storeService.getStoreDashboard(req.params.id, requireUser(req));
  sendSuccess(res, data);
});

export const products = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req, { name: 1 });
  const { items, total } = await storeService.getStoreProducts(req.params.id, requireUser(req), pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const inventory = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req, { createdAt: -1 });
  const { items, total } = await storeService.getStoreInventory(req.params.id, requireUser(req), pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const listDocuments = catchAsync(async (req: Request, res: Response) => {
  const documents = await storeService.listStoreDocuments(req.params.storeId, requireUser(req));
  sendSuccess(res, documents);
});

export const addDocument = catchAsync(async (req: Request, res: Response) => {
  const document = await storeService.addStoreDocument(req.params.storeId, req.body, requireUser(req));
  sendSuccess(res, document, 'Document added successfully', 201);
});

export const updateDocument = catchAsync(async (req: Request, res: Response) => {
  const document = await storeService.updateStoreDocument(
    req.params.storeId,
    req.params.documentId,
    req.body,
    requireUser(req),
  );
  sendSuccess(res, document, 'Document updated successfully');
});

export const deleteDocument = catchAsync(async (req: Request, res: Response) => {
  await storeService.deleteStoreDocument(req.params.storeId, req.params.documentId, requireUser(req));
  sendSuccess(res, null, 'Document deleted successfully');
});
