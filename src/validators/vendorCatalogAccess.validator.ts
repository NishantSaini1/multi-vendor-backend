import { z } from 'zod';

const objectId = z.string().length(24);

export const grantVendorCatalogAccessSchema = z.object({
  params: z.object({ vendorId: objectId }),
  body: z.object({
    categoryId: objectId,
    subcategoryId: objectId.nullable().optional(),
  }),
});

export const vendorCatalogAccessParamsSchema = z.object({
  params: z.object({ vendorId: objectId, accessId: objectId }),
});
