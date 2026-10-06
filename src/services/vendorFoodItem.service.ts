import { VendorFoodItem } from '../models/VendorFoodItem';
import { FoodVariant } from '../models/FoodVariant';
import { ModifierGroup } from '../models/ModifierGroup';
import { ModifierOption } from '../models/ModifierOption';
import { Vendor } from '../models/Vendor';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertOwnerOrLocationAccess } from '../middleware/rbac.middleware';
import { GLOBAL_FOOD_ITEM_STATUS } from '../constants/enums';
import { findFoodProductOrThrow } from './foodProduct.service';
import { assertVendorHasCatalogAccess } from './vendorCatalogAccess.service';
import { applyProductPricing, childItemForViewer, hasPricingRequest, isMarkupModel, pricingRequestFromInput, productForViewer, round2, toPricingConfig } from './pricing.service';

async function assertVendorAccess(vendorId: string, user: JwtPayload) {
  const vendor = await Vendor.findById(vendorId);
  if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
  assertOwnerOrLocationAccess(user, vendor.id, vendor.locationId.toString());
  return vendor;
}

// The global FoodProduct fields every VendorFoodItem response embeds under
// globalFoodItemId — a vendor's menu UI needs the item's name/images/etc. on
// every read AND write response (list/getById/create/update/availability),
// never just a bare id, so every function below that returns a VendorFoodItem
// populates it the same way.
const GLOBAL_ITEM_POPULATE_FIELDS = 'name slug description images foodType categoryId subcategoryId';

export async function listVendorFoodItems(
  vendorId: string,
  filter: Record<string, unknown>,
  pagination: PaginationParams,
  user: JwtPayload,
) {
  await assertVendorAccess(vendorId, user);
  const query = { ...filter, vendorId };
  const [items, total] = await Promise.all([
    VendorFoodItem.find(query)
      .populate('globalFoodItemId', GLOBAL_ITEM_POPULATE_FIELDS)
      .sort(pagination.sort)
      .skip(pagination.skip)
      .limit(pagination.limit),
    VendorFoodItem.countDocuments(query),
  ]);
  // Only an admin sees a product's markup.
  return { items: items.map((item) => productForViewer(item.toJSON() as Record<string, unknown>, user.userType)), total };
}

// "Add existing item" — a vendor picks a globalFoodItemId from the browsable
// catalog (GET /food-items) and lists it at their own price. Requires a
// VendorCatalogAccess grant covering the item's category/subcategory.
export async function addVendorFoodItem(
  vendorId: string,
  data: {
    globalFoodItemId: string;
    // The Selling Price (what customers pay; `platformSellingPrice` is an
    // accepted alias). Required, and never above the MRP.
    price?: number;
    platformSellingPrice?: number;
    // Admin-only, MARKUP vendors.
    markupPercent?: number;
    // The printed MRP; the selling price may not exceed it.
    mrp?: number;
    costPrice?: number;
    preparationTime?: number;
    vendorSku?: string;
  },
  user: JwtPayload,
) {
  const vendor = await assertVendorAccess(vendorId, user);

  const globalItem = await findFoodProductOrThrow(data.globalFoodItemId);
  if (globalItem.status !== GLOBAL_FOOD_ITEM_STATUS.ACTIVE) {
    throw ApiError.unprocessable('This item is not active in the global catalog', 'FOOD_PRODUCT_NOT_ACTIVE');
  }
  await assertVendorHasCatalogAccess(vendorId, globalItem.categoryId.toString(), globalItem.subcategoryId?.toString());

  const config = toPricingConfig(vendor);
  const pricing: Record<string, number | undefined> = {};
  applyProductPricing(pricing, 'price', config, user, pricingRequestFromInput(data as Record<string, unknown>, 'price'), data.mrp);

  try {
    const item = await VendorFoodItem.create({
      vendorId,
      globalFoodItemId: data.globalFoodItemId,
      price: pricing.price,
      markupPercent: pricing.markupPercent,
      markupAmount: pricing.markupAmount,
      pricingSchemaVersion: 3,
      mrp: data.mrp,
      costPrice: data.costPrice,
      preparationTime: data.preparationTime,
      vendorSku: data.vendorSku,
    });
    await item.populate('globalFoodItemId', GLOBAL_ITEM_POPULATE_FIELDS);
    return productForViewer(item.toJSON() as Record<string, unknown>, user.userType);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: number }).code === 11000) {
      throw ApiError.conflict('You already have a listing for this item', 'VENDOR_FOOD_ITEM_ALREADY_EXISTS');
    }
    throw err;
  }
}

// Exported for reuse by order.service.ts-adjacent lookups and foodItemSubmission.service.ts.
export async function findVendorFoodItemOrThrow(vendorId: string, id: string) {
  const item = await VendorFoodItem.findOne({ _id: id, vendorId });
  if (!item) throw ApiError.notFound('Vendor food item not found', 'VENDOR_FOOD_ITEM_NOT_FOUND');
  return item;
}

export async function getVendorFoodItemById(vendorId: string, id: string, user: JwtPayload) {
  await assertVendorAccess(vendorId, user);
  const item = await findVendorFoodItemOrThrow(vendorId, id);
  await item.populate('globalFoodItemId', GLOBAL_ITEM_POPULATE_FIELDS);
  return productForViewer(item.toJSON() as Record<string, unknown>, user.userType);
}

export async function updateVendorFoodItem(vendorId: string, id: string, data: Record<string, unknown>, user: JwtPayload) {
  const vendor = await assertVendorAccess(vendorId, user);
  const item = await findVendorFoodItemOrThrow(vendorId, id);

  // Never reassignable via a plain update — a vendor relists a different
  // global item by creating a new VendorFoodItem instead.
  delete data.vendorId;
  delete data.globalFoodItemId;

  // Pricing (selling price / vendor original price / markup) is applied by
  // pricing.service so the fields stay consistent and the MRP rule is enforced.
  const config = toPricingConfig(vendor);
  const request = pricingRequestFromInput(data, 'price');

  Object.assign(item, data);
  if (hasPricingRequest(request) || data.mrp !== undefined) {
    applyProductPricing(item, 'price', config, user, request, item.mrp);
  }
  await item.save();
  await item.populate('globalFoodItemId', GLOBAL_ITEM_POPULATE_FIELDS);
  return productForViewer(item.toJSON() as Record<string, unknown>, user.userType);
}

export async function deleteVendorFoodItem(vendorId: string, id: string, user: JwtPayload) {
  await assertVendorAccess(vendorId, user);
  const item = await findVendorFoodItemOrThrow(vendorId, id);

  const groupIds = await ModifierGroup.find({ vendorFoodItemId: id }).distinct('_id');
  await ModifierOption.deleteMany({ modifierGroupId: { $in: groupIds } });
  await ModifierGroup.deleteMany({ vendorFoodItemId: id });
  await FoodVariant.deleteMany({ vendorFoodItemId: id });
  await item.deleteOne();
}

export async function updateVendorFoodItemAvailability(
  vendorId: string,
  id: string,
  availabilityStatus: string,
  user: JwtPayload,
) {
  return updateVendorFoodItem(vendorId, id, { availabilityStatus }, user);
}

// --- Variants ---

export async function listFoodVariants(vendorId: string, itemId: string, user: JwtPayload) {
  await assertVendorAccess(vendorId, user);
  await findVendorFoodItemOrThrow(vendorId, itemId);
  const variants = await FoodVariant.find({ vendorFoodItemId: itemId }).sort({ isDefault: -1, name: 1 });
  return variants.map((v) => childItemForViewer(v.toJSON() as Record<string, unknown>, 'price', user.userType));
}

function extractMarkupAmount(data: Record<string, unknown>, vendor: { pricingModel?: string; commissionPercent?: number }, user: JwtPayload): number {
  const markupAmount = typeof data.markupAmount === 'number' ? data.markupAmount : undefined;
  delete data.markupAmount;
  if (markupAmount === undefined) return 0;
  if (user.userType !== 'ADMIN') throw ApiError.forbidden('Only the platform can set a markup on variants or add-ons', 'MARKUP_ADMIN_ONLY');
  if (!isMarkupModel(toPricingConfig(vendor))) throw ApiError.badRequest('A markup can only be set for a seller on the MARKUP pricing model', 'NOT_A_MARKUP_SELLER');
  if (markupAmount < 0) throw ApiError.badRequest('Markup amount must be non-negative', 'INVALID_MARKUP_AMOUNT');
  return round2(markupAmount);
}

export async function createFoodVariant(vendorId: string, itemId: string, data: Record<string, unknown>, user: JwtPayload) {
  const vendor = await assertVendorAccess(vendorId, user);
  await findVendorFoodItemOrThrow(vendorId, itemId);
  const markupAmount = extractMarkupAmount(data, vendor, user);
  const variant = await FoodVariant.create({ ...data, vendorFoodItemId: itemId, markupAmount });
  return childItemForViewer(variant.toJSON() as Record<string, unknown>, 'price', user.userType);
}

export async function updateFoodVariant(
  vendorId: string,
  itemId: string,
  variantId: string,
  data: Record<string, unknown>,
  user: JwtPayload,
) {
  const vendor = await assertVendorAccess(vendorId, user);
  await findVendorFoodItemOrThrow(vendorId, itemId);

  const hasMarkup = typeof data.markupAmount === 'number';
  const markupAmount = extractMarkupAmount(data, vendor, user);
  const update: Record<string, unknown> = { ...data };
  if (hasMarkup) update.markupAmount = markupAmount;

  const variant = await FoodVariant.findOneAndUpdate({ _id: variantId, vendorFoodItemId: itemId }, update, { new: true });
  if (!variant) throw ApiError.notFound('Food variant not found', 'FOOD_VARIANT_NOT_FOUND');
  return childItemForViewer(variant.toJSON() as Record<string, unknown>, 'price', user.userType);
}

export async function deleteFoodVariant(vendorId: string, itemId: string, variantId: string, user: JwtPayload) {
  await assertVendorAccess(vendorId, user);
  await findVendorFoodItemOrThrow(vendorId, itemId);

  const variant = await FoodVariant.findOneAndDelete({ _id: variantId, vendorFoodItemId: itemId });
  if (!variant) throw ApiError.notFound('Food variant not found', 'FOOD_VARIANT_NOT_FOUND');
}

// --- Modifier groups ---

async function findModifierGroupOrThrow(itemId: string, groupId: string) {
  const group = await ModifierGroup.findOne({ _id: groupId, vendorFoodItemId: itemId });
  if (!group) throw ApiError.notFound('Modifier group not found', 'MODIFIER_GROUP_NOT_FOUND');
  return group;
}

export async function listModifierGroups(vendorId: string, itemId: string, user: JwtPayload) {
  await assertVendorAccess(vendorId, user);
  await findVendorFoodItemOrThrow(vendorId, itemId);
  return ModifierGroup.find({ vendorFoodItemId: itemId }).sort({ createdAt: 1 });
}

export async function createModifierGroup(vendorId: string, itemId: string, data: Record<string, unknown>, user: JwtPayload) {
  await assertVendorAccess(vendorId, user);
  await findVendorFoodItemOrThrow(vendorId, itemId);
  return ModifierGroup.create({ ...data, vendorFoodItemId: itemId });
}

export async function updateModifierGroup(
  vendorId: string,
  itemId: string,
  groupId: string,
  data: Record<string, unknown>,
  user: JwtPayload,
) {
  await assertVendorAccess(vendorId, user);
  await findVendorFoodItemOrThrow(vendorId, itemId);
  const group = await findModifierGroupOrThrow(itemId, groupId);

  delete data.vendorFoodItemId;
  Object.assign(group, data);
  await group.save();
  return group;
}

export async function deleteModifierGroup(vendorId: string, itemId: string, groupId: string, user: JwtPayload) {
  await assertVendorAccess(vendorId, user);
  await findVendorFoodItemOrThrow(vendorId, itemId);
  await findModifierGroupOrThrow(itemId, groupId);

  await ModifierOption.deleteMany({ modifierGroupId: groupId });
  await ModifierGroup.deleteOne({ _id: groupId });
}

// --- Modifier options ---

export async function listModifierOptions(vendorId: string, itemId: string, groupId: string, user: JwtPayload) {
  await assertVendorAccess(vendorId, user);
  await findVendorFoodItemOrThrow(vendorId, itemId);
  await findModifierGroupOrThrow(itemId, groupId);
  const options = await ModifierOption.find({ modifierGroupId: groupId }).sort({ createdAt: 1 });
  return options.map((o) => childItemForViewer(o.toJSON() as Record<string, unknown>, 'price', user.userType));
}

export async function createModifierOption(
  vendorId: string,
  itemId: string,
  groupId: string,
  data: Record<string, unknown>,
  user: JwtPayload,
) {
  const vendor = await assertVendorAccess(vendorId, user);
  await findVendorFoodItemOrThrow(vendorId, itemId);
  await findModifierGroupOrThrow(itemId, groupId);
  const markupAmount = extractMarkupAmount(data, vendor, user);
  const option = await ModifierOption.create({ ...data, modifierGroupId: groupId, markupAmount });
  return childItemForViewer(option.toJSON() as Record<string, unknown>, 'price', user.userType);
}

export async function updateModifierOption(
  vendorId: string,
  itemId: string,
  groupId: string,
  optionId: string,
  data: Record<string, unknown>,
  user: JwtPayload,
) {
  const vendor = await assertVendorAccess(vendorId, user);
  await findVendorFoodItemOrThrow(vendorId, itemId);
  await findModifierGroupOrThrow(itemId, groupId);

  const hasMarkup = typeof data.markupAmount === 'number';
  const markupAmount = extractMarkupAmount(data, vendor, user);
  const update: Record<string, unknown> = { ...data };
  if (hasMarkup) update.markupAmount = markupAmount;

  const option = await ModifierOption.findOneAndUpdate({ _id: optionId, modifierGroupId: groupId }, update, { new: true });
  if (!option) throw ApiError.notFound('Modifier option not found', 'MODIFIER_OPTION_NOT_FOUND');
  return childItemForViewer(option.toJSON() as Record<string, unknown>, 'price', user.userType);
}

export async function deleteModifierOption(
  vendorId: string,
  itemId: string,
  groupId: string,
  optionId: string,
  user: JwtPayload,
) {
  await assertVendorAccess(vendorId, user);
  await findVendorFoodItemOrThrow(vendorId, itemId);
  await findModifierGroupOrThrow(itemId, groupId);

  const option = await ModifierOption.findOneAndDelete({ _id: optionId, modifierGroupId: groupId });
  if (!option) throw ApiError.notFound('Modifier option not found', 'MODIFIER_OPTION_NOT_FOUND');
}
