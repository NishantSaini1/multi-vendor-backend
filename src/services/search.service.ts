import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { FoodProduct } from '../models/FoodProduct';
import { FoodCategory } from '../models/FoodCategory';
import { VendorFoodItem } from '../models/VendorFoodItem';
import { InstamartProduct } from '../models/InstamartProduct';
import { InstamartGlobalProduct } from '../models/InstamartGlobalProduct';
import { InstamartCategory } from '../models/InstamartCategory';
import { VENDOR_STATUS, APPROVAL_STATUS, STORE_STATUS, GENERIC_STATUS, GLOBAL_FOOD_ITEM_STATUS } from '../constants/enums';
import { BUSINESS_TYPES } from '../constants/orderStatus';

interface SearchFilter {
  locationId?: string;
  businessType?: string;
}

const RESULT_LIMIT = 15;
// Upper bound on GLOBAL catalog matches considered before joining to the
// per-seller listings. The location/status filter is applied on the listing
// join, so this must be well above RESULT_LIMIT — otherwise the first 15
// global matches could all belong to sellers elsewhere and the customer's
// own city would get nothing back.
const CANDIDATE_LIMIT = 500;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Case-insensitive substring matching rather than MongoDB $text: $text only
// matches whole stemmed words, so a customer typing "piz" or "biry" got no
// results until the full word was typed. Each whitespace-separated term must
// appear (in any of the given fields) — "veg pizza" matches "Veg Farmhouse
// Pizza". A match on the item's category name counts too, so "biryani"
// finds every dish filed under the Biryani category.
function buildMatch(terms: RegExp[], fields: string[], extra: Record<string, unknown>[] = []) {
  return {
    $and: terms.map((term) => ({ $or: [...fields.map((field) => ({ [field]: term })), ...extra] })),
  };
}

export async function search(query: string, filter: SearchFilter) {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => new RegExp(escapeRegex(t), 'i'));
  const whole = new RegExp(escapeRegex(query.trim()), 'i');
  const scope: Record<string, unknown> = {};
  if (filter.locationId) scope.locationId = filter.locationId;

  const includeFood = !filter.businessType || filter.businessType === BUSINESS_TYPES.FOOD;
  const includeInstamart = !filter.businessType || filter.businessType === BUSINESS_TYPES.INSTAMART;

  const [foodCategoryIds, instamartCategoryIds] = await Promise.all([
    includeFood ? FoodCategory.find({ name: whole, status: GENERIC_STATUS.ACTIVE }).distinct('_id') : Promise.resolve([]),
    includeInstamart
      ? InstamartCategory.find({ name: whole, status: GENERIC_STATUS.ACTIVE }).distinct('_id')
      : Promise.resolve([]),
  ]);

  const foodCategoryMatch = foodCategoryIds.length ? [{ categoryId: { $in: foodCategoryIds } }] : [];
  const instamartCategoryMatch = instamartCategoryIds.length ? [{ categoryId: { $in: instamartCategoryIds } }] : [];

  const [vendors, matchedFoodProducts, stores, matchedGlobalProducts] = await Promise.all([
    includeFood
      ? Vendor.find({
          ...buildMatch(terms, ['restaurantName']),
          ...scope,
          status: VENDOR_STATUS.ACTIVE,
          approvalStatus: APPROVAL_STATUS.APPROVED,
        })
          .sort({ isOpen: -1, rating: -1 })
          .limit(RESULT_LIMIT)
      : Promise.resolve([]),
    // No locationId field on the GLOBAL FoodProduct — location scoping for
    // Food happens below, via the vendor a listing belongs to.
    includeFood
      ? FoodProduct.find({
          ...(foodCategoryMatch.length
            ? { $or: [buildMatch(terms, ['name', 'description']), ...foodCategoryMatch] }
            : buildMatch(terms, ['name', 'description'])),
          status: GLOBAL_FOOD_ITEM_STATUS.ACTIVE,
        }).limit(CANDIDATE_LIMIT)
      : Promise.resolve([]),
    includeInstamart
      ? Store.find({ ...buildMatch(terms, ['name']), ...scope, status: STORE_STATUS.ACTIVE }).limit(RESULT_LIMIT)
      : Promise.resolve([]),
    includeInstamart
      ? InstamartGlobalProduct.find({
          ...(instamartCategoryMatch.length
            ? { $or: [buildMatch(terms, ['name', 'brand']), ...instamartCategoryMatch] }
            : buildMatch(terms, ['name', 'brand'])),
          approvalStatus: APPROVAL_STATUS.APPROVED,
          status: GENERIC_STATUS.ACTIVE,
        }).limit(CANDIDATE_LIMIT)
      : Promise.resolve([]),
  ]);

  let foodProducts: Record<string, unknown>[] = [];
  if (matchedFoodProducts.length > 0) {
    const globalById = new Map(matchedFoodProducts.map((g) => [g._id.toString(), g]));
    // Only listings from vendors a customer could actually order from (and,
    // when given, in their city) — same visibility rule as the vendor results.
    const eligibleVendorIds = await Vendor.find({
      ...scope,
      status: VENDOR_STATUS.ACTIVE,
      approvalStatus: APPROVAL_STATUS.APPROVED,
    }).distinct('_id');

    const listings = await VendorFoodItem.find({
      globalFoodItemId: { $in: matchedFoodProducts.map((g) => g._id) },
      vendorId: { $in: eligibleVendorIds },
      status: GENERIC_STATUS.ACTIVE,
    })
      .limit(RESULT_LIMIT)
      .populate('vendorId', 'restaurantName logo rating ratingCount');

    foodProducts = listings
      .filter((listing) => listing.vendorId)
      .map((listing) => {
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
    const activeStoreIds = await Store.find({ ...scope, status: STORE_STATUS.ACTIVE }).distinct('_id');

    const mappings = await InstamartProduct.find({
      productId: { $in: matchedGlobalProducts.map((g) => g._id) },
      storeId: { $in: activeStoreIds },
      status: GENERIC_STATUS.ACTIVE,
      ...scope,
    })
      .limit(RESULT_LIMIT)
      .populate('storeId', 'name logo rating ratingCount');

    instamartProducts = mappings
      .filter((mapping) => mapping.storeId)
      .map((mapping) => {
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
