import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import { locationScopeFilter } from '../middleware/rbac.middleware';
import * as storeService from '../services/store.service';

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
  if (req.query.search) filter.name = { $regex: String(req.query.search), $options: 'i' };

  const { items, total } = await storeService.listStores(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const store = await storeService.createStore(req.body);
  sendSuccess(res, store, 'Store created successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const store = await storeService.getStoreById(req.params.id, requireUser(req));
  sendSuccess(res, store);
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
