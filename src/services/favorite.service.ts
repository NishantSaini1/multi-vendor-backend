import { Types } from 'mongoose';
import { CustomerFavorite, FAVORITE_TYPES } from '../models/CustomerFavorite';
import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { VendorFoodItem } from '../models/VendorFoodItem';
import { InstamartProduct } from '../models/InstamartProduct';
import { DEFAULT_PRICING_CONFIG, loadPricingConfigs, markupFoodItem, markupMartListing } from './pricing.service';

export interface FavoriteInput {
  type: string;
  targetId: string;
  name: string;
  image?: string;
  meta?: { businessType?: 'FOOD' | 'INSTAMART'; vendorId?: string; storeId?: string; sellerName?: string };
}

// Saved items plus live status from the source records, so the app can show
// "Closed now" / current price / "Unavailable" without extra requests.
// A favourite whose target has since been deleted is returned with
// live.exists = false (the app offers to remove it) rather than dropped.
export async function listFavorites(customerId: string) {
  const favorites = await CustomerFavorite.find({ customerId }).sort({ createdAt: -1 }).lean();

  const ids = (type: string, business?: string) =>
    favorites
      .filter((f) => f.type === type && (!business || (f.meta?.businessType ?? 'FOOD') === business))
      .map((f) => f.targetId);

  const [vendors, stores, foodItems, martItems] = await Promise.all([
    Vendor.find({ _id: { $in: ids(FAVORITE_TYPES.VENDOR) } }).select('restaurantName logo coverImage rating ratingCount isOpen status').lean(),
    Store.find({ _id: { $in: ids(FAVORITE_TYPES.STORE) } }).select('name logo rating status openingTime closingTime').lean(),
    VendorFoodItem.find({ _id: { $in: ids(FAVORITE_TYPES.PRODUCT, 'FOOD') } }).select('price mrp markupPercent availabilityStatus status vendorId').lean(),
    InstamartProduct.find({ _id: { $in: ids(FAVORITE_TYPES.PRODUCT, 'INSTAMART') } }).select('sellingPrice markupPercent mrp status storeId').lean(),
  ]);
  // Favorites show the live price a customer would pay, so apply each
  // seller's pricing model (MARKUP adds the platform markup).
  const [vendorPricing, storePricing] = await Promise.all([
    loadPricingConfigs('VENDOR', foodItems.map((p) => String(p.vendorId))),
    loadPricingConfigs('STORE', martItems.map((p) => String(p.storeId))),
  ]);
  const byId = <T extends { _id: unknown }>(rows: T[]) => new Map(rows.map((r) => [String(r._id), r]));
  const vMap = byId(vendors);
  const sMap = byId(stores);
  const fMap = byId(foodItems);
  const mMap = byId(martItems);

  return favorites.map((f) => {
    const id = String(f.targetId);
    let live: Record<string, unknown> = { exists: false };
    if (f.type === FAVORITE_TYPES.VENDOR) {
      const v = vMap.get(id) as Record<string, unknown> | undefined;
      if (v) live = { exists: true, name: v.restaurantName, image: v.coverImage ?? v.logo, logo: v.logo, rating: v.rating, ratingCount: v.ratingCount, isOpen: v.isOpen && v.status === 'ACTIVE' };
    } else if (f.type === FAVORITE_TYPES.STORE) {
      const s = sMap.get(id) as Record<string, unknown> | undefined;
      if (s) live = { exists: true, name: s.name, image: s.logo, rating: s.rating, isOpen: s.status === 'ACTIVE', openingTime: s.openingTime, closingTime: s.closingTime };
    } else if ((f.meta?.businessType ?? 'FOOD') === 'FOOD') {
      const p = fMap.get(id) as Record<string, unknown> | undefined;
      if (p) {
        const shown = markupFoodItem({ price: p.price as number, mrp: p.mrp as number | undefined, markupPercent: p.markupPercent as number | undefined }, vendorPricing.get(String(p.vendorId)) ?? DEFAULT_PRICING_CONFIG);
        live = { exists: true, price: shown.price, mrp: shown.mrp, available: p.availabilityStatus === 'AVAILABLE' && p.status === 'ACTIVE', vendorId: String(p.vendorId) };
      }
    } else {
      const p = mMap.get(id) as Record<string, unknown> | undefined;
      if (p) {
        const shown = markupMartListing({ sellingPrice: p.sellingPrice as number, markupPercent: p.markupPercent as number | undefined }, storePricing.get(String(p.storeId)) ?? DEFAULT_PRICING_CONFIG);
        live = { exists: true, price: shown.sellingPrice, mrp: p.mrp, available: p.status === 'ACTIVE', storeId: String(p.storeId) };
      }
    }
    return { ...f, id: String(f._id), targetId: id, live };
  });
}

export async function addFavorite(customerId: string, input: FavoriteInput) {
  return CustomerFavorite.findOneAndUpdate(
    { customerId, type: input.type, targetId: input.targetId },
    { $set: { name: input.name, image: input.image, meta: input.meta ?? {} } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function removeFavorite(customerId: string, type: string, targetId: string) {
  await CustomerFavorite.deleteOne({ customerId, type, targetId });
}

// One-shot upload of favourites that were saved on the device before sync
// existed. Existing server rows win (never overwritten by stale local data).
export async function importFavorites(customerId: string, items: FavoriteInput[]) {
  if (!items.length) return { imported: 0 };
  const owner = new Types.ObjectId(customerId);
  const res = await CustomerFavorite.bulkWrite(
    items.map((i) => {
      const target = new Types.ObjectId(i.targetId);
      return {
        updateOne: {
          filter: { customerId: owner, type: i.type, targetId: target },
          update: {
            $setOnInsert: { customerId: owner, type: i.type, targetId: target, name: i.name, image: i.image, meta: i.meta ?? {} },
          },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );
  return { imported: res.upsertedCount };
}
