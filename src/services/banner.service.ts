import { Banner } from '../models/Banner';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { GENERIC_STATUS } from '../constants/enums';

export async function listBanners(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Banner.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Banner.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createBanner(data: Record<string, unknown>) {
  return Banner.create(data);
}

async function findBannerOrThrow(id: string) {
  const banner = await Banner.findById(id);
  if (!banner) throw ApiError.notFound('Banner not found', 'BANNER_NOT_FOUND');
  return banner;
}

export async function getBannerById(id: string) {
  return findBannerOrThrow(id);
}

export async function updateBanner(id: string, data: Record<string, unknown>) {
  const banner = await findBannerOrThrow(id);
  Object.assign(banner, data);
  await banner.save();
  return banner;
}

export async function deleteBanner(id: string) {
  const banner = await findBannerOrThrow(id);
  await banner.deleteOne();
}

export async function updateBannerStatus(id: string, status: string) {
  return updateBanner(id, { status });
}

// Public "what to show" query for a given placement slot — ranked by
// sortOrder like a carousel. VENDOR/STORE placements require an exact match
// (a vendor banner only ever means that one vendor); LOCATION optionally
// narrows by locationId when given but a global LOCATION banner (no
// locationId set) still shows everywhere, mirroring Offer's "empty scope
// array means everywhere" convention even though here it's a single
// optional field rather than an array.
export async function listActiveBanners(filter: { placement: string; locationId?: string; vendorId?: string; storeId?: string }) {
  const now = new Date();
  const clauses: Record<string, unknown>[] = [
    { placement: filter.placement },
    { status: GENERIC_STATUS.ACTIVE },
    { $or: [{ startDate: { $exists: false } }, { startDate: { $lte: now } }] },
    { $or: [{ endDate: { $exists: false } }, { endDate: { $gte: now } }] },
  ];
  if (filter.vendorId) clauses.push({ vendorId: filter.vendorId });
  if (filter.storeId) clauses.push({ storeId: filter.storeId });
  if (filter.locationId) clauses.push({ $or: [{ locationId: { $exists: false } }, { locationId: filter.locationId }] });

  return Banner.find({ $and: clauses }).sort({ sortOrder: 1, createdAt: -1 });
}
