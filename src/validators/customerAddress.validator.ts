import { z } from 'zod';
import { ADDRESS_TYPES } from '../constants/enums';

const objectId = z.string().length(24);

export const createCustomerAddressSchema = z.object({
  params: z.object({ customerId: objectId }),
  body: z.object({
    locationId: objectId,
    address: z.string().min(3),
    landmark: z.string().optional(),
    pincode: z.string().min(4).max(10),
    latitude: z.number(),
    longitude: z.number(),
    type: z.enum([ADDRESS_TYPES.HOME, ADDRESS_TYPES.WORK, ADDRESS_TYPES.OTHER]).default(ADDRESS_TYPES.HOME),
    isDefault: z.boolean().default(false),
  }),
});

export const updateCustomerAddressSchema = z.object({
  params: z.object({ customerId: objectId, addressId: objectId }),
  body: createCustomerAddressSchema.shape.body.partial(),
});

export const customerAddressListParamsSchema = z.object({
  params: z.object({ customerId: objectId }),
});

export const customerAddressParamsSchema = z.object({
  params: z.object({ customerId: objectId, addressId: objectId }),
});
