import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as vendorFoodItemService from '../services/vendorFoodItem.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

// --- Vendor food items ---

export const list = catchAsync(async (req: Request, res: Response) => {
  const user = requireUser(req);
  const pagination = parsePagination(req, { createdAt: -1 });

  const filter: Record<string, unknown> = {};
  if (req.query.globalFoodItemId) filter.globalFoodItemId = req.query.globalFoodItemId;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.availabilityStatus) filter.availabilityStatus = req.query.availabilityStatus;

  const { items, total } = await vendorFoodItemService.listVendorFoodItems(req.params.vendorId, filter, pagination, user);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const item = await vendorFoodItemService.addVendorFoodItem(req.params.vendorId, req.body, requireUser(req));
  sendSuccess(res, item, 'Food item added to your menu successfully', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const item = await vendorFoodItemService.getVendorFoodItemById(req.params.vendorId, req.params.id, requireUser(req));
  sendSuccess(res, item);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const item = await vendorFoodItemService.updateVendorFoodItem(req.params.vendorId, req.params.id, req.body, requireUser(req));
  sendSuccess(res, item, 'Vendor food item updated successfully');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await vendorFoodItemService.deleteVendorFoodItem(req.params.vendorId, req.params.id, requireUser(req));
  sendSuccess(res, null, 'Vendor food item deleted successfully');
});

export const updateAvailability = catchAsync(async (req: Request, res: Response) => {
  const item = await vendorFoodItemService.updateVendorFoodItemAvailability(
    req.params.vendorId,
    req.params.id,
    req.body.availabilityStatus,
    requireUser(req),
  );
  sendSuccess(res, item, 'Vendor food item availability updated');
});

// --- Variants ---

export const listVariants = catchAsync(async (req: Request, res: Response) => {
  const variants = await vendorFoodItemService.listFoodVariants(req.params.vendorId, req.params.id, requireUser(req));
  sendSuccess(res, variants);
});

export const createVariant = catchAsync(async (req: Request, res: Response) => {
  const variant = await vendorFoodItemService.createFoodVariant(req.params.vendorId, req.params.id, req.body, requireUser(req));
  sendSuccess(res, variant, 'Food variant created successfully', 201);
});

export const updateVariant = catchAsync(async (req: Request, res: Response) => {
  const variant = await vendorFoodItemService.updateFoodVariant(
    req.params.vendorId,
    req.params.id,
    req.params.variantId,
    req.body,
    requireUser(req),
  );
  sendSuccess(res, variant, 'Food variant updated successfully');
});

export const deleteVariant = catchAsync(async (req: Request, res: Response) => {
  await vendorFoodItemService.deleteFoodVariant(req.params.vendorId, req.params.id, req.params.variantId, requireUser(req));
  sendSuccess(res, null, 'Food variant deleted successfully');
});

// --- Modifier groups ---

export const listModifierGroups = catchAsync(async (req: Request, res: Response) => {
  const groups = await vendorFoodItemService.listModifierGroups(req.params.vendorId, req.params.id, requireUser(req));
  sendSuccess(res, groups);
});

export const createModifierGroup = catchAsync(async (req: Request, res: Response) => {
  const group = await vendorFoodItemService.createModifierGroup(req.params.vendorId, req.params.id, req.body, requireUser(req));
  sendSuccess(res, group, 'Modifier group created successfully', 201);
});

export const updateModifierGroup = catchAsync(async (req: Request, res: Response) => {
  const group = await vendorFoodItemService.updateModifierGroup(
    req.params.vendorId,
    req.params.id,
    req.params.groupId,
    req.body,
    requireUser(req),
  );
  sendSuccess(res, group, 'Modifier group updated successfully');
});

export const deleteModifierGroup = catchAsync(async (req: Request, res: Response) => {
  await vendorFoodItemService.deleteModifierGroup(req.params.vendorId, req.params.id, req.params.groupId, requireUser(req));
  sendSuccess(res, null, 'Modifier group deleted successfully');
});

// --- Modifier options ---

export const listModifierOptions = catchAsync(async (req: Request, res: Response) => {
  const options = await vendorFoodItemService.listModifierOptions(
    req.params.vendorId,
    req.params.id,
    req.params.groupId,
    requireUser(req),
  );
  sendSuccess(res, options);
});

export const createModifierOption = catchAsync(async (req: Request, res: Response) => {
  const option = await vendorFoodItemService.createModifierOption(
    req.params.vendorId,
    req.params.id,
    req.params.groupId,
    req.body,
    requireUser(req),
  );
  sendSuccess(res, option, 'Modifier option created successfully', 201);
});

export const updateModifierOption = catchAsync(async (req: Request, res: Response) => {
  const option = await vendorFoodItemService.updateModifierOption(
    req.params.vendorId,
    req.params.id,
    req.params.groupId,
    req.params.optionId,
    req.body,
    requireUser(req),
  );
  sendSuccess(res, option, 'Modifier option updated successfully');
});

export const deleteModifierOption = catchAsync(async (req: Request, res: Response) => {
  await vendorFoodItemService.deleteModifierOption(
    req.params.vendorId,
    req.params.id,
    req.params.groupId,
    req.params.optionId,
    requireUser(req),
  );
  sendSuccess(res, null, 'Modifier option deleted successfully');
});
