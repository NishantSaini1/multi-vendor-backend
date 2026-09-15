import { z } from 'zod';
import { BUSINESS_TYPES } from '../constants/orderStatus';
import { PAYMENT_METHODS, PAYMENT_STATUS } from '../constants/paymentStatus';

const objectId = z.string().length(24);

const orderItemModifierInput = z.object({
  modifierOptionId: objectId,
  quantity: z.number().int().positive().default(1),
});

const orderItemInput = z.object({
  // FOOD: a VendorFoodItem._id; INSTAMART: an InstamartProduct._id — see
  // OrderItem.ts for why this field keeps the name `productId` either way.
  productId: objectId,
  variantId: objectId.optional(),
  quantity: z.number().int().positive(),
  // Modifier selections (FOOD only — must be empty for INSTAMART items, see
  // order.service.ts's prepareInstamartItems).
  modifiers: z.array(orderItemModifierInput).default([]),
});

export const createOrderSchema = z.object({
  body: z
    .object({
      // Either a cartId (FOOD checkout from the server-side Cart — see
      // cart.service.ts / order.service.ts's createOrder) or an inline
      // businessType+items[] (either business type, the original path).
      cartId: objectId.optional(),
      businessType: z.enum([BUSINESS_TYPES.FOOD, BUSINESS_TYPES.INSTAMART]).optional(),
      vendorId: objectId.optional(),
      storeId: objectId.optional(),
      addressId: objectId,
      items: z.array(orderItemInput).optional(),
      paymentMethod: z.enum([PAYMENT_METHODS.RAZORPAY, PAYMENT_METHODS.COD, PAYMENT_METHODS.WALLET]),
      couponCode: z.string().trim().min(1).optional(),
    })
    .refine((data) => !!data.cartId || (!!data.businessType && !!data.items && data.items.length > 0), {
      message: 'Either cartId or businessType with a non-empty items array is required',
    })
    .refine((data) => !!data.cartId || data.businessType !== BUSINESS_TYPES.FOOD || !!data.vendorId, {
      message: 'vendorId is required for FOOD orders',
    })
    .refine((data) => !!data.cartId || data.businessType !== BUSINESS_TYPES.INSTAMART || !!data.storeId, {
      message: 'storeId is required for INSTAMART orders',
    }),
});

export const orderIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateOrderStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.string().min(1), reason: z.string().optional() }),
});

export const cancelOrderSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ reason: z.string().min(3) }),
});

export const updateOrderSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    deliveryAddress: z
      .object({
        address: z.string().min(3).optional(),
        landmark: z.string().optional(),
        pincode: z.string().min(4).max(10).optional(),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      })
      .optional(),
  }),
});

export const listOrdersQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    locationId: objectId.optional(),
    businessType: z.enum([BUSINESS_TYPES.FOOD, BUSINESS_TYPES.INSTAMART]).optional(),
    status: z.string().optional(),
    customerId: objectId.optional(),
    vendorId: objectId.optional(),
    storeId: objectId.optional(),
    deliveryPartnerId: objectId.optional(),
    paymentStatus: z.enum(Object.values(PAYMENT_STATUS) as [string, ...string[]]).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    search: z.string().optional(),
  }),
});
