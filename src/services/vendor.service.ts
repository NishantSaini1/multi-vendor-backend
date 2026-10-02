import mongoose from 'mongoose';
import { Vendor } from '../models/Vendor';
import { VendorDocument } from '../models/VendorDocument';
import { VendorFoodItem } from '../models/VendorFoodItem';
import { FoodCategory } from '../models/FoodCategory';
import { FoodProduct } from '../models/FoodProduct';
import { Location } from '../models/Location';
import { Commission } from '../models/Commission';
import { ApiError } from '../utils/ApiError';
import { hashPassword } from '../utils/password';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess } from '../middleware/rbac.middleware';
import { VENDOR_STATUS, APPROVAL_STATUS, COMMISSION_LEVELS, GENERIC_STATUS, VENDOR_FOOD_ITEM_AVAILABILITY } from '../constants/enums';
import { BUSINESS_TYPES } from '../constants/orderStatus';
import { findSellersInRange } from '../utils/geoQuery';
import { DEFAULT_PRICING_CONFIG, markupFoodItem, syncSellerProductPrices, toPricingConfig } from './pricing.service';

export async function listVendors(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Vendor.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Vendor.countDocuments(filter),
  ]);
  return { items, total };
}

// Customer browse by delivery address: only restaurants whose own
// serviceRadius reaches (lat, lng) — the same rule order creation enforces
// (OUT_OF_SELLER_RANGE) — nearest first.
export function listVendorsByDistance(filter: Record<string, unknown>, pagination: PaginationParams, lat: number, lng: number) {
  return findSellersInRange(Vendor, filter, pagination, lat, lng);
}

// Accepts an optional commissionType/commissionValue pair alongside the usual
// vendor fields — when both are present, a VENDOR-level Commission rule is
// created for the new vendor in the same transaction (so a vendor never
// exists with an ambiguous, half-created commission setup).
export async function createVendor(data: Record<string, unknown>) {
  const locationExists = await Location.exists({ _id: data.locationId });
  if (!locationExists) throw ApiError.notFound('Location not found', 'LOCATION_NOT_FOUND');

  const { commissionType, commissionValue, ...vendorData } = data as Record<string, unknown> & {
    commissionType?: string;
    commissionValue?: number;
  };

  const password = await hashPassword(vendorData.password as string);

  const session = await mongoose.startSession();
  try {
    let createdVendor: InstanceType<typeof Vendor> | undefined;
    await session.withTransaction(async () => {
      const [vendor] = await Vendor.create(
        [{ ...vendorData, password, status: VENDOR_STATUS.ACTIVE, approvalStatus: APPROVAL_STATUS.PENDING }],
        { session },
      );
      createdVendor = vendor;

      if (commissionType && commissionValue !== undefined) {
        await Commission.create(
          [
            {
              level: COMMISSION_LEVELS.VENDOR,
              vendorId: vendor.id,
              businessType: BUSINESS_TYPES.FOOD,
              type: commissionType,
              value: commissionValue,
              status: GENERIC_STATUS.ACTIVE,
            },
          ],
          { session },
        );
      }
    });
    return createdVendor as InstanceType<typeof Vendor>;
  } finally {
    await session.endSession();
  }
}

async function findVendorOrThrow(id: string) {
  const vendor = await Vendor.findById(id);
  if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
  return vendor;
}

// `locationId` is a required field on the schema, but a small number of
// legacy records predate that constraint and have it missing — guard here so
// those surface as a clear 422 instead of crashing every admin vendor
// endpoint with an unhandled `Cannot read properties of undefined` 500.
function requireVendorLocationId(vendor: { locationId?: unknown }): string {
  if (!vendor.locationId) {
    throw ApiError.unprocessable(
      'This vendor record has no location assigned and cannot be managed until one is set',
      'VENDOR_MISSING_LOCATION',
    );
  }
  return (vendor.locationId as { toString(): string }).toString();
}

// A vendor may view/update their own record (e.g. the open/closed toggle and
// their own profile in the Vendor App); anyone else goes through ordinary
// admin location scoping.
function assertVendorAccess(user: JwtPayload, vendor: { id?: string; locationId?: unknown }): void {
  if (user.userType === 'VENDOR') {
    if (user.userId !== vendor.id) throw ApiError.forbidden('You do not have access to this resource', 'OWNER_FORBIDDEN');
    return;
  }
  assertLocationAccess(user, requireVendorLocationId(vendor));
}

export async function getVendorById(id: string, user: JwtPayload) {
  const vendor = await findVendorOrThrow(id);
  assertVendorAccess(user, vendor);
  return vendor;
}

export async function updateVendor(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const vendor = await findVendorOrThrow(id);
  assertVendorAccess(user, vendor);

  // A vendor may edit their own profile, but never reassign which location
  // they belong to — that stays an admin-only action.
  const payload = user.userType === 'VENDOR' ? { ...data } : data;
  if (user.userType === 'VENDOR') {
    delete payload.locationId;
    // A vendor picks its own pricing model but never sets the platform's rate.
    delete payload.commissionPercent;
  }
  const pricingChanged = payload.pricingModel !== undefined || payload.commissionPercent !== undefined;

  Object.assign(vendor, payload);
  // Validate only the fields this request changed. Vendors created before
  // vendorTypeIds replaced the free-text `cuisines` array have no
  // vendorTypeIds, so a full-document validation failed *every* PATCH — even
  // a bare { isOpen } open/close toggle — with "Validation failed". Anything
  // the request does set (including vendorTypeIds itself) is still validated.
  await vendor.save({ validateModifiedOnly: true });
  // A new pricing model changes every item's platform price.
  if (pricingChanged) await syncSellerProductPrices('VENDOR', vendor.id);
  return vendor;
}

export async function deleteVendor(id: string, user: JwtPayload) {
  const vendor = await findVendorOrThrow(id);
  assertLocationAccess(user, requireVendorLocationId(vendor));
  await vendor.deleteOne();
}

export async function updateVendorStatus(id: string, status: string, user: JwtPayload) {
  return updateVendor(id, { status }, user);
}

export async function approveVendor(id: string, user: JwtPayload) {
  const vendor = await findVendorOrThrow(id);
  assertLocationAccess(user, requireVendorLocationId(vendor));
  vendor.approvalStatus = APPROVAL_STATUS.APPROVED;
  vendor.status = VENDOR_STATUS.ACTIVE;
  await vendor.save();
  return vendor;
}

export async function rejectVendor(id: string, reason: string, user: JwtPayload) {
  const vendor = await findVendorOrThrow(id);
  assertLocationAccess(user, requireVendorLocationId(vendor));
  vendor.approvalStatus = APPROVAL_STATUS.REJECTED;
  vendor.status = VENDOR_STATUS.INACTIVE;
  await vendor.save();
  return { vendor, reason };
}

export async function suspendVendor(id: string, user: JwtPayload) {
  return updateVendorStatus(id, VENDOR_STATUS.SUSPENDED, user);
}

export async function activateVendor(id: string, user: JwtPayload) {
  return updateVendorStatus(id, VENDOR_STATUS.ACTIVE, user);
}

export async function getVendorDashboard(id: string, user: JwtPayload) {
  const vendor = await findVendorOrThrow(id);
  assertLocationAccess(user, requireVendorLocationId(vendor));

  // Since Stage 2, price/availability live on the vendor's own VendorFoodItem
  // listing, not the (now global) FoodProduct — see vendorFoodItem.service.ts.
  const [productCount, availableProductCount] = await Promise.all([
    VendorFoodItem.countDocuments({ vendorId: id }),
    VendorFoodItem.countDocuments({ vendorId: id, availabilityStatus: VENDOR_FOOD_ITEM_AVAILABILITY.AVAILABLE }),
  ]);

  return {
    productCount,
    availableProductCount,
    rating: vendor.rating,
    ratingCount: vendor.ratingCount,
    isOpen: vendor.isOpen,
    status: vendor.status,
    approvalStatus: vendor.approvalStatus,
  };
}

export async function getVendorProducts(
  id: string,
  user: JwtPayload,
  pagination: PaginationParams,
  extraFilter: Record<string, unknown> = {},
) {
  const vendor = await findVendorOrThrow(id);
  assertLocationAccess(user, requireVendorLocationId(vendor));

  const query = { vendorId: id, ...extraFilter };
  const [items, total] = await Promise.all([
    VendorFoodItem.find(query)
      .populate('globalFoodItemId', 'name slug description images foodType categoryId subcategoryId')
      .sort(pagination.sort)
      .skip(pagination.skip)
      .limit(pagination.limit),
    VendorFoodItem.countDocuments(query),
  ]);

  // Resolve each item's category name here (one query), since the customer
  // /food/categories listing hides vendor-private and INACTIVE categories —
  // without this a menu can't label items filed under those. Additive
  // fields only; the populated globalFoodItemId shape is unchanged.
  const categoryIds = [
    ...new Set(
      items
        .map((item) => (item.globalFoodItemId as unknown as { categoryId?: mongoose.Types.ObjectId } | null)?.categoryId?.toString())
        .filter((cid): cid is string => Boolean(cid)),
    ),
  ];
  const categories = categoryIds.length
    ? await FoodCategory.find({ _id: { $in: categoryIds } }).select('name displayOrder')
    : [];
  const categoryById = new Map(categories.map((c) => [c.id as string, c]));
  // A customer sees the price they'd actually pay — under the MARKUP pricing
  // model that's the vendor's price plus the platform markup (see
  // pricing.service.ts); vendor/admin views keep the vendor's own price.
  const pricing = user.userType === 'CUSTOMER' ? toPricingConfig(vendor) : DEFAULT_PRICING_CONFIG;
  const withCategory = items.map((item) => {
    const cid = (item.globalFoodItemId as unknown as { categoryId?: mongoose.Types.ObjectId } | null)?.categoryId?.toString();
    const category = cid ? categoryById.get(cid) : undefined;
    return markupFoodItem(
      {
        ...item.toJSON(),
        categoryName: category?.name ?? null,
        categoryDisplayOrder: (category as unknown as { displayOrder?: number } | undefined)?.displayOrder ?? null,
      } as Record<string, unknown>,
      pricing,
    );
  });
  return { items: withCategory, total };
}

export async function listVendorDocuments(vendorId: string, user: JwtPayload) {
  const vendor = await findVendorOrThrow(vendorId);
  assertLocationAccess(user, requireVendorLocationId(vendor));
  return VendorDocument.find({ vendorId }).sort({ createdAt: -1 });
}

export async function addVendorDocument(vendorId: string, data: Record<string, unknown>, user: JwtPayload) {
  const vendor = await findVendorOrThrow(vendorId);
  assertLocationAccess(user, requireVendorLocationId(vendor));
  return VendorDocument.create({ ...data, vendorId });
}

export async function updateVendorDocument(
  vendorId: string,
  documentId: string,
  data: Record<string, unknown>,
  user: JwtPayload,
) {
  const vendor = await findVendorOrThrow(vendorId);
  assertLocationAccess(user, requireVendorLocationId(vendor));

  const document = await VendorDocument.findOneAndUpdate({ _id: documentId, vendorId }, data, { new: true });
  if (!document) throw ApiError.notFound('Vendor document not found', 'VENDOR_DOCUMENT_NOT_FOUND');
  return document;
}

export async function deleteVendorDocument(vendorId: string, documentId: string, user: JwtPayload) {
  const vendor = await findVendorOrThrow(vendorId);
  assertLocationAccess(user, requireVendorLocationId(vendor));

  const document = await VendorDocument.findOneAndDelete({ _id: documentId, vendorId });
  if (!document) throw ApiError.notFound('Vendor document not found', 'VENDOR_DOCUMENT_NOT_FOUND');
}

// Ids of vendors that currently list at least one active item from a global
// food category (optionally narrowed to a subcategory) — what a customer
// tapping a category should see.
export async function vendorIdsSellingCategory(categoryId: string, subcategoryId?: string): Promise<string[]> {
  const productFilter: Record<string, unknown> = { categoryId };
  if (subcategoryId) productFilter.subcategoryId = subcategoryId;
  const productIds = await FoodProduct.find(productFilter).distinct('_id');
  if (productIds.length === 0) return [];
  const vendorIds = await VendorFoodItem.find({
    globalFoodItemId: { $in: productIds },
    status: GENERIC_STATUS.ACTIVE,
  }).distinct('vendorId');
  return vendorIds.map((id) => String(id));
}
