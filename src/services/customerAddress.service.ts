import { CustomerAddress } from '../models/CustomerAddress';
import { Customer } from '../models/Customer';
import { Location } from '../models/Location';
import { ApiError } from '../utils/ApiError';
import { JwtPayload } from '../utils/jwt';

function assertCustomerAccess(user: JwtPayload, customerId: string): void {
  if (user.userType === 'CUSTOMER' && user.userId !== customerId) {
    throw ApiError.forbidden('You do not have access to this customer', 'CUSTOMER_FORBIDDEN');
  }
}

async function assertCustomerExists(customerId: string): Promise<void> {
  const exists = await Customer.exists({ _id: customerId });
  if (!exists) throw ApiError.notFound('Customer not found', 'CUSTOMER_NOT_FOUND');
}

export async function listCustomerAddresses(customerId: string, user: JwtPayload) {
  assertCustomerAccess(user, customerId);
  await assertCustomerExists(customerId);
  return CustomerAddress.find({ customerId }).sort({ isDefault: -1, createdAt: -1 });
}

export async function createCustomerAddress(customerId: string, data: Record<string, unknown>, user: JwtPayload) {
  assertCustomerAccess(user, customerId);
  await assertCustomerExists(customerId);

  const locationExists = await Location.exists({ _id: data.locationId });
  if (!locationExists) throw ApiError.notFound('Location not found', 'LOCATION_NOT_FOUND');

  const existingCount = await CustomerAddress.countDocuments({ customerId });
  const isFirstAddress = existingCount === 0;
  const isDefault = isFirstAddress || Boolean(data.isDefault);

  if (isDefault) {
    await CustomerAddress.updateMany({ customerId, isDefault: true }, { isDefault: false });
  }

  return CustomerAddress.create({ ...data, customerId, isDefault });
}

async function findAddressOrThrow(customerId: string, addressId: string) {
  const address = await CustomerAddress.findOne({ _id: addressId, customerId });
  if (!address) throw ApiError.notFound('Address not found', 'ADDRESS_NOT_FOUND');
  return address;
}

export async function getCustomerAddressById(customerId: string, addressId: string, user: JwtPayload) {
  assertCustomerAccess(user, customerId);
  return findAddressOrThrow(customerId, addressId);
}

export async function updateCustomerAddress(
  customerId: string,
  addressId: string,
  data: Record<string, unknown>,
  user: JwtPayload,
) {
  assertCustomerAccess(user, customerId);
  const address = await findAddressOrThrow(customerId, addressId);

  if (data.locationId) {
    const locationExists = await Location.exists({ _id: data.locationId });
    if (!locationExists) throw ApiError.notFound('Location not found', 'LOCATION_NOT_FOUND');
  }

  if (data.isDefault === true && !address.isDefault) {
    await CustomerAddress.updateMany({ customerId, isDefault: true }, { isDefault: false });
  }

  Object.assign(address, data);
  await address.save();
  return address;
}

export async function deleteCustomerAddress(customerId: string, addressId: string, user: JwtPayload) {
  assertCustomerAccess(user, customerId);
  const address = await findAddressOrThrow(customerId, addressId);
  const wasDefault = address.isDefault;
  await address.deleteOne();

  if (wasDefault) {
    const nextAddress = await CustomerAddress.findOne({ customerId }).sort({ createdAt: 1 });
    if (nextAddress) {
      nextAddress.isDefault = true;
      await nextAddress.save();
    }
  }
}

export async function setDefaultCustomerAddress(customerId: string, addressId: string, user: JwtPayload) {
  assertCustomerAccess(user, customerId);
  await findAddressOrThrow(customerId, addressId);

  await CustomerAddress.updateMany({ customerId, isDefault: true }, { isDefault: false });
  const address = await CustomerAddress.findOneAndUpdate(
    { _id: addressId, customerId },
    { isDefault: true },
    { new: true },
  );
  return address!;
}
