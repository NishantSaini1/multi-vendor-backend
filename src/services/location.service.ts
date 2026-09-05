import { Location } from '../models/Location';
import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { Order } from '../models/Order';
import { DeliveryPartner } from '../models/DeliveryPartner';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';

export async function listLocations(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Location.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Location.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createLocation(data: Record<string, unknown>) {
  return Location.create(data);
}

export async function getLocationById(id: string) {
  const location = await Location.findById(id);
  if (!location) throw ApiError.notFound('Location not found', 'LOCATION_NOT_FOUND');
  return location;
}

export async function updateLocation(id: string, data: Record<string, unknown>) {
  const location = await Location.findByIdAndUpdate(id, data, { new: true, runValidators: true });
  if (!location) throw ApiError.notFound('Location not found', 'LOCATION_NOT_FOUND');
  return location;
}

export async function deleteLocation(id: string) {
  const location = await Location.findByIdAndDelete(id);
  if (!location) throw ApiError.notFound('Location not found', 'LOCATION_NOT_FOUND');
}

export async function updateLocationStatus(id: string, status: string) {
  return updateLocation(id, { status });
}

export async function getLocationSettings(id: string) {
  const location = await getLocationById(id);
  return location.settings;
}

export async function updateLocationSettings(id: string, settings: Record<string, unknown>) {
  const location = await getLocationById(id);
  location.settings = { ...location.settings, ...settings };
  await location.save();
  return location.settings;
}

export async function getLocationDashboard(id: string) {
  await getLocationById(id);

  const [vendorCount, storeCount, deliveryPartnerCount, orderCount, activeOrderCount] = await Promise.all([
    Vendor.countDocuments({ locationId: id }),
    Store.countDocuments({ locationId: id }),
    DeliveryPartner.countDocuments({ locationId: id }),
    Order.countDocuments({ locationId: id }),
    Order.countDocuments({ locationId: id, status: { $nin: ['DELIVERED', 'CANCELLED'] } }),
  ]);

  return { vendorCount, storeCount, deliveryPartnerCount, orderCount, activeOrderCount };
}
