import { z } from 'zod';
import { BANNER_MEDIA_TYPES, BANNER_PLACEMENTS, GENERIC_STATUS } from '../constants/enums';
import { BUSINESS_TYPES } from '../constants/orderStatus';

const businessType = z.enum(Object.values(BUSINESS_TYPES) as [string, ...string[]]);
const mediaType = z.enum(Object.values(BANNER_MEDIA_TYPES) as [string, ...string[]]);

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
      subtitle: z.string().trim().max(120).optional(),
      ctaLabel: z.string().trim().max(24).optional(),
      image: z.string().trim().min(1),
      mediaType: mediaType.default(BANNER_MEDIA_TYPES.IMAGE),
      videoUrl: z.string().trim().url().optional(),
      placement: z.enum(Object.values(BANNER_PLACEMENTS) as [string, ...string[]]),
      businessType: businessType.optional(),
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
    .refine((data) => data.mediaType !== BANNER_MEDIA_TYPES.VIDEO || !!data.videoUrl, {
      message: 'VIDEO banners require videoUrl',
      path: ['videoUrl'],
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
    subtitle: z.string().trim().max(120).optional(),
    ctaLabel: z.string().trim().max(24).optional(),
    image: z.string().trim().min(1).optional(),
    mediaType: mediaType.optional(),
    videoUrl: z.string().trim().url().optional(),
    businessType: businessType.optional(),
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
    businessType: businessType.optional(),
    status: z.enum(Object.values(GENERIC_STATUS) as [string, ...string[]]).optional(),
  }),
});

export const activeBannersQuerySchema = z.object({
  query: z.object({
    placement: z.enum(Object.values(BANNER_PLACEMENTS) as [string, ...string[]]),
    businessType: businessType.optional(),
    locationId: objectId.optional(),
    vendorId: objectId.optional(),
    storeId: objectId.optional(),
  }),
});
