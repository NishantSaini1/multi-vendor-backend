import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { FoodProduct } from '../models/FoodProduct';
import { VendorFoodItem } from '../models/VendorFoodItem';
import { InstamartProduct } from '../models/InstamartProduct';
import { InstamartGlobalProduct } from '../models/InstamartGlobalProduct';
import { VENDOR_STATUS, APPROVAL_STATUS, STORE_STATUS, GENERIC_STATUS, GLOBAL_FOOD_ITEM_STATUS } from '../constants/enums';
import { BUSINESS_TYPES } from '../constants/orderStatus';

interface SearchFilter {
  locationId?: string;
  businessType?: string;
}

const RESULT_LIMIT = 15;

// MongoDB $text search across the browsable, name-searched collections. Since
// Stage 2, a Food item's name/description/foodType live on the shared, GLOBAL
// FoodProduct (see foodProduct.service.ts) rather than a vendor-owned record
// — search matches there first, then joins in each vendor's own ACTIVE
// listing (VendorFoodItem) of that item, flattening the global fields onto
// the result, the exact same "match global, then join per-seller listing"
// shape instamartProduct.service.ts already uses for Instamart below. Public
// and unauthenticated: search is core browsing, same as GET /offers/active
// and GET /banners/active.
export async function search(query: string, filter: SearchFilter) {
  const textSearch = { $text: { $search: query } };
  const scope: Record<string, unknown> = {};
  if (filter.locationId) scope.locationId = filter.locationId;

  const includeFood = !filter.businessType || filter.businessType === BUSINESS_TYPES.FOOD;
  const includeInstamart = !filter.businessType || filter.businessType === BUSINESS_TYPES.INSTAMART;

  const [vendors, matchedFoodProducts, stores, matchedGlobalProducts] = await Promise.all([
    includeFood
      ? Vendor.find({ ...textSearch, ...scope, status: VENDOR_STATUS.ACTIVE, approvalStatus: APPROVAL_STATUS.APPROVED }).limit(RESULT_LIMIT)
      : Promise.resolve([]),
    // No locationId field on the GLOBAL FoodProduct anymore — location
    // scoping for Food happens below, via the vendor a listing belongs to.
    includeFood
      ? FoodProduct.find({ ...textSearch, status: GLOBAL_FOOD_ITEM_STATUS.ACTIVE }).limit(RESULT_LIMIT)
      : Promise.resolve([]),
    includeInstamart
      ? Store.find({ ...textSearch, ...scope, status: STORE_STATUS.ACTIVE }).limit(RESULT_LIMIT)
      : Promise.resolve([]),
    includeInstamart
      ? InstamartGlobalProduct.find({ ...textSearch, approvalStatus: APPROVAL_STATUS.APPROVED, status: GENERIC_STATUS.ACTIVE }).limit(RESULT_LIMIT)
      : Promise.resolve([]),
  ]);

  let foodProducts: Record<string, unknown>[] = [];
  if (matchedFoodProducts.length > 0) {
    const globalById = new Map(matchedFoodProducts.map((g) => [g._id.toString(), g]));
    const vendorFilter: Record<string, unknown> = {};
    if (filter.locationId) {
      const vendorIdsInLocation = await Vendor.find({ locationId: filter.locationId }).distinct('_id');
      vendorFilter.vendorId = { $in: vendorIdsInLocation };
    }

    const listings = await VendorFoodItem.find({
      globalFoodItemId: { $in: matchedFoodProducts.map((g) => g._id) },
      status: GENERIC_STATUS.ACTIVE,
      ...vendorFilter,
    })
      .limit(RESULT_LIMIT)
      .populate('vendorId', 'restaurantName logo rating ratingCount');

    foodProducts = listings.map((listing) => {
      const globalItem = globalById.get(listing.globalFoodItemId.toString())!;
      const plain = listing.toObject() as unknown as Record<string, unknown>;
      Object.assign(plain, {
        name: globalItem.name,
        description: globalItem.description,
        images: globalItem.images,
        foodType: globalItem.foodType,
      });
      const vendor = plain.vendorId as unknown as {
        _id: unknown;
        restaurantName: string;
        logo?: string;
        rating: number;
        ratingCount: number;
      };
      plain.vendorId = vendor._id;
      plain.vendor = { _id: vendor._id, restaurantName: vendor.restaurantName, logo: vendor.logo, rating: vendor.rating, ratingCount: vendor.ratingCount };
      return plain;
    });
  }

  let instamartProducts: Record<string, unknown>[] = [];
  if (matchedGlobalProducts.length > 0) {
    const globalById = new Map(matchedGlobalProducts.map((g) => [g._id.toString(), g]));
    const mappings = await InstamartProduct.find({
      productId: { $in: matchedGlobalProducts.map((g) => g._id) },
      status: GENERIC_STATUS.ACTIVE,
      ...scope,
    })
      .limit(RESULT_LIMIT)
      .populate('storeId', 'name logo rating ratingCount');

    instamartProducts = mappings.map((mapping) => {
      const globalProduct = globalById.get(mapping.productId.toString())!;
      const plain = mapping.toObject() as unknown as Record<string, unknown>;
      Object.assign(plain, {
        name: globalProduct.name,
        brand: globalProduct.brand,
        images: globalProduct.images,
        unit: globalProduct.unit,
        packSize: globalProduct.packSize,
        weight: globalProduct.weight,
        mrp: globalProduct.mrp,
      });
      const store = plain.storeId as unknown as { _id: unknown; name: string; logo?: string; rating: number; ratingCount: number };
      plain.storeId = store._id;
      plain.store = { _id: store._id, name: store.name, logo: store.logo, rating: store.rating, ratingCount: store.ratingCount };
      return plain;
    });
  }

  return { vendors, foodProducts, stores, instamartProducts };
}
