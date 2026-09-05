import { DeliveryPartner } from '../models/DeliveryPartner';
import { DeliveryPartnerDocument } from '../models/DeliveryPartnerDocument';
import { DeliveryPartnerVehicle } from '../models/DeliveryPartnerVehicle';
import { Location } from '../models/Location';
import { ApiError } from '../utils/ApiError';
import { hashPassword } from '../utils/password';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertOwnerOrLocationAccess, assertLocationAccess } from '../middleware/rbac.middleware';
import { DELIVERY_PARTNER_STATUS, DELIVERY_PARTNER_AVAILABILITY } from '../constants/deliveryStatus';
import { markPartnerActive, markPartnerInactive } from './deliveryPartnerLocation.service';

export async function listDeliveryPartners(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    DeliveryPartner.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    DeliveryPartner.countDocuments(filter),
  ]);
  return { items, total };
}

export async function createDeliveryPartner(data: Record<string, unknown>) {
  const locationExists = await Location.exists({ _id: data.locationId });
  if (!locationExists) throw ApiError.notFound('Location not found', 'LOCATION_NOT_FOUND');

  const password = await hashPassword(data.password as string);
  return DeliveryPartner.create({ ...data, password, status: DELIVERY_PARTNER_STATUS.PENDING });
}

async function findPartnerOrThrow(id: string) {
  const partner = await DeliveryPartner.findById(id);
  if (!partner) throw ApiError.notFound('Delivery partner not found', 'DELIVERY_PARTNER_NOT_FOUND');
  return partner;
}

export async function getDeliveryPartnerById(id: string, user: JwtPayload) {
  const partner = await findPartnerOrThrow(id);
  assertOwnerOrLocationAccess(user, partner.id, partner.locationId.toString());
  return partner;
}

export async function updateDeliveryPartner(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const partner = await findPartnerOrThrow(id);
  assertLocationAccess(user, partner.locationId.toString());
  Object.assign(partner, data);
  await partner.save();
  return partner;
}

export async function deleteDeliveryPartner(id: string, user: JwtPayload) {
  const partner = await findPartnerOrThrow(id);
  assertLocationAccess(user, partner.locationId.toString());
  await markPartnerInactive(partner.locationId.toString(), partner.id);
  await partner.deleteOne();
}

export async function updateDeliveryPartnerStatus(id: string, status: string, user: JwtPayload) {
  const partner = await updateDeliveryPartner(id, { status }, user);
  if (status !== DELIVERY_PARTNER_STATUS.ACTIVE) {
    await markPartnerInactive(partner.locationId.toString(), partner.id);
  }
  return partner;
}

export async function approveDeliveryPartner(id: string, user: JwtPayload) {
  return updateDeliveryPartnerStatus(id, DELIVERY_PARTNER_STATUS.ACTIVE, user);
}

export async function rejectDeliveryPartner(id: string, reason: string, user: JwtPayload) {
  const partner = await updateDeliveryPartnerStatus(id, DELIVERY_PARTNER_STATUS.BLOCKED, user);
  return { partner, reason };
}

export async function suspendDeliveryPartner(id: string, user: JwtPayload) {
  return updateDeliveryPartnerStatus(id, DELIVERY_PARTNER_STATUS.SUSPENDED, user);
}

export async function activateDeliveryPartner(id: string, user: JwtPayload) {
  return updateDeliveryPartnerStatus(id, DELIVERY_PARTNER_STATUS.ACTIVE, user);
}

export async function updateAvailability(id: string, availability: string, user: JwtPayload) {
  const partner = await findPartnerOrThrow(id);
  assertOwnerOrLocationAccess(user, partner.id, partner.locationId.toString());

  if (partner.status !== DELIVERY_PARTNER_STATUS.ACTIVE) {
    throw ApiError.forbidden('Only an active delivery partner can change availability', 'DELIVERY_PARTNER_NOT_ACTIVE');
  }

  partner.availability = availability;
  await partner.save();

  const locationId = partner.locationId.toString();
  if (availability === DELIVERY_PARTNER_AVAILABILITY.ONLINE) {
    if (partner.currentLatitude !== undefined && partner.currentLongitude !== undefined) {
      await markPartnerActive(locationId, partner.id, partner.currentLongitude, partner.currentLatitude);
    }
  } else {
    await markPartnerInactive(locationId, partner.id);
  }

  return partner;
}

export async function updateDeliveryPartnerLocation(
  id: string,
  latitude: number,
  longitude: number,
  user: JwtPayload,
) {
  const partner = await findPartnerOrThrow(id);
  assertOwnerOrLocationAccess(user, partner.id, partner.locationId.toString());

  partner.currentLatitude = latitude;
  partner.currentLongitude = longitude;
  partner.currentLocationUpdatedAt = new Date();
  await partner.save();

  if (partner.availability === DELIVERY_PARTNER_AVAILABILITY.ONLINE) {
    await markPartnerActive(partner.locationId.toString(), partner.id, longitude, latitude);
  }

  return partner;
}

export async function getDeliveryPartnerLocation(id: string, user: JwtPayload) {
  const partner = await findPartnerOrThrow(id);
  assertOwnerOrLocationAccess(user, partner.id, partner.locationId.toString());
  return {
    latitude: partner.currentLatitude,
    longitude: partner.currentLongitude,
    updatedAt: partner.currentLocationUpdatedAt,
  };
}

export async function listDeliveryPartnerDocuments(partnerId: string, user: JwtPayload) {
  const partner = await findPartnerOrThrow(partnerId);
  assertLocationAccess(user, partner.locationId.toString());
  return DeliveryPartnerDocument.find({ deliveryPartnerId: partnerId }).sort({ createdAt: -1 });
}

export async function addDeliveryPartnerDocument(partnerId: string, data: Record<string, unknown>, user: JwtPayload) {
  const partner = await findPartnerOrThrow(partnerId);
  assertLocationAccess(user, partner.locationId.toString());
  return DeliveryPartnerDocument.create({ ...data, deliveryPartnerId: partnerId });
}

export async function updateDeliveryPartnerDocument(
  partnerId: string,
  documentId: string,
  data: Record<string, unknown>,
  user: JwtPayload,
) {
  const partner = await findPartnerOrThrow(partnerId);
  assertLocationAccess(user, partner.locationId.toString());

  const document = await DeliveryPartnerDocument.findOneAndUpdate(
    { _id: documentId, deliveryPartnerId: partnerId },
    data,
    { new: true },
  );
  if (!document) throw ApiError.notFound('Document not found', 'DELIVERY_PARTNER_DOCUMENT_NOT_FOUND');
  return document;
}

export async function deleteDeliveryPartnerDocument(partnerId: string, documentId: string, user: JwtPayload) {
  const partner = await findPartnerOrThrow(partnerId);
  assertLocationAccess(user, partner.locationId.toString());

  const document = await DeliveryPartnerDocument.findOneAndDelete({ _id: documentId, deliveryPartnerId: partnerId });
  if (!document) throw ApiError.notFound('Document not found', 'DELIVERY_PARTNER_DOCUMENT_NOT_FOUND');
}

export async function getDeliveryPartnerVehicle(id: string, user: JwtPayload) {
  const partner = await findPartnerOrThrow(id);
  assertOwnerOrLocationAccess(user, partner.id, partner.locationId.toString());

  const vehicle = await DeliveryPartnerVehicle.findOne({ deliveryPartnerId: id });
  if (!vehicle) throw ApiError.notFound('Vehicle not found', 'VEHICLE_NOT_FOUND');
  return vehicle;
}

export async function upsertDeliveryPartnerVehicle(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const partner = await findPartnerOrThrow(id);
  assertOwnerOrLocationAccess(user, partner.id, partner.locationId.toString());

  return DeliveryPartnerVehicle.findOneAndUpdate(
    { deliveryPartnerId: id },
    { ...data, deliveryPartnerId: id, isVerified: false },
    { new: true, upsert: true, runValidators: true },
  );
}
