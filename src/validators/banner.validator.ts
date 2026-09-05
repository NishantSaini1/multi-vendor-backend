import { z } from 'zod';
import { BANNER_PLACEMENTS, GENERIC_STATUS } from '../constants/enums';

const objectId = z.string().length(24);

const placementRefinement = (data: { placement: string; locationId?: string; vendorId?: string; storeId?: string }) => {
  if (data.placement === BANNER_PLACEMENTS.VENDOR) return !!data.vendorId;
  if (data.placement === BANNER_PLACEMENTS.STORE) return !!data.storeId;
  if (data.placement === BANNER_PLACEMENTS.LOCATION) return !!data.locationId;
  return true;
};

export const createBannerSchema = z.object({
  body: z
    .object({
      title: z.string().trim().min(1),
      image: z.string().trim().min(1),
      placement: z.enum(Object.values(BANNER_PLACEMENTS) as [string, ...string[]]),
      locationId: objectId.optional(),
      vendorId: objectId.optional(),
      storeId: objectId.optional(),
      linkType: z.string().optional(),
      linkValue: z.string().optional(),
      sortOrder: z.number().int().default(0),
      startDate: z.coerce.date().optional(),
      endDate: z.coerce.date().optional(),
    })
    .refine(placementRefinement, {
      message: 'LOCATION placement requires locationId, VENDOR requires vendorId, STORE requires storeId',
    })
    .refine((data) => !data.startDate || !data.endDate || data.startDate < data.endDate, {
      message: 'startDate must be before endDate',
      path: ['endDate'],
    }),
});

export const bannerIdParamSchema = z.object({
  params: z.object({ id: objectId }),
});

export const updateBannerSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    title: z.string().trim().min(1).optional(),
    image: z.string().trim().min(1).optional(),
    linkType: z.string().optional(),
    linkValue: z.string().optional(),
    sortOrder: z.number().int().optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  }),
});

export const updateBannerStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ status: z.enum(Object.values(GENERIC_STATUS) as [string, ...string[]]) }),
});

export const listBannersQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    placement: z.enum(Object.values(BANNER_PLACEMENTS) as [string, ...string[]]).optional(),
    status: z.enum(Object.values(GENERIC_STATUS) as [string, ...string[]]).optional(),
  }),
});

export const activeBannersQuerySchema = z.object({
  query: z.object({
    placement: z.enum(Object.values(BANNER_PLACEMENTS) as [string, ...string[]]),
    locationId: objectId.optional(),
    vendorId: objectId.optional(),
    storeId: objectId.optional(),
  }),
});
