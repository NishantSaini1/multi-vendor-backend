import { z } from 'zod';
import { BUSINESS_TYPES } from '../constants/orderStatus';
import { PAYMENT_METHODS, PAYMENT_STATUS } from '../constants/paymentStatus';

const objectId = z.string().length(24);

const orderItemAddonInput = z.object({
  addonId: objectId,
  quantity: z.number().int().positive().default(1),
});

const orderItemInput = z.object({
  productId: objectId,
  variantId: objectId.optional(),
  quantity: z.number().int().positive(),
  addons: z.array(orderItemAddonInput).default([]),
});

export const createOrderSchema = z.object({
  body: z
    .object({
      businessType: z.enum([BUSINESS_TYPES.FOOD, BUSINESS_TYPES.INSTAMART]),
      vendorId: objectId.optional(),
      storeId: objectId.optional(),
      addressId: objectId,
      items: z.array(orderItemInput).min(1),
      paymentMethod: z.enum([PAYMENT_METHODS.RAZORPAY, PAYMENT_METHODS.COD, PAYMENT_METHODS.WALLET]),
      couponCode: z.string().trim().min(1).optional(),
    })
    .refine((data) => (data.businessType === BUSINESS_TYPES.FOOD ? !!data.vendorId : !!data.storeId), {
      message: 'vendorId is required for FOOD orders, storeId is required for INSTAMART orders',
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
