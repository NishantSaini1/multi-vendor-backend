import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { FoodProduct } from '../models/FoodProduct';
import { InstamartProduct } from '../models/InstamartProduct';
import { VENDOR_STATUS, APPROVAL_STATUS, STORE_STATUS, GENERIC_STATUS } from '../constants/enums';
import { BUSINESS_TYPES } from '../constants/orderStatus';

interface SearchFilter {
  locationId?: string;
  businessType?: string;
}

const RESULT_LIMIT = 15;

// MongoDB $text search across the four browsable, name-searched
// collections — each already carries (or, for Vendor/Store, now carries) a
// text index for exactly this purpose. Public and unauthenticated: search
// is core browsing, same as GET /offers/active and GET /banners/active.
export async function search(query: string, filter: SearchFilter) {
  const textSearch = { $text: { $search: query } };
  const scope: Record<string, unknown> = {};
  if (filter.locationId) scope.locationId = filter.locationId;

  const includeFood = !filter.businessType || filter.businessType === BUSINESS_TYPES.FOOD;
  const includeInstamart = !filter.businessType || filter.businessType === BUSINESS_TYPES.INSTAMART;

  const [vendors, foodProducts, stores, instamartProducts] = await Promise.all([
    includeFood
      ? Vendor.find({ ...textSearch, ...scope, status: VENDOR_STATUS.ACTIVE, approvalStatus: APPROVAL_STATUS.APPROVED }).limit(RESULT_LIMIT)
      : Promise.resolve([]),
    includeFood
      ? FoodProduct.find({ ...textSearch, ...scope, status: GENERIC_STATUS.ACTIVE, isAvailable: true }).limit(RESULT_LIMIT)
      : Promise.resolve([]),
    includeInstamart
      ? Store.find({ ...textSearch, ...scope, status: STORE_STATUS.ACTIVE }).limit(RESULT_LIMIT)
      : Promise.resolve([]),
    includeInstamart
      ? InstamartProduct.find({ ...textSearch, ...scope, status: GENERIC_STATUS.ACTIVE }).limit(RESULT_LIMIT)
      : Promise.resolve([]),
  ]);

  return { vendors, foodProducts, stores, instamartProducts };
}
