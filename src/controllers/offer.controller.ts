import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import * as offerService from '../services/offer.service';

export const list = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;

  const { items, total } = await offerService.listOffers(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const create = catchAsync(async (req: Request, res: Response) => {
  const offer = await offerService.createOffer(req.body);
  sendSuccess(res, offer, 'Offer created', 201);
});

export const getById = catchAsync(async (req: Request, res: Response) => {
  const offer = await offerService.getOfferById(req.params.id);
  sendSuccess(res, offer);
});

export const update = catchAsync(async (req: Request, res: Response) => {
  const offer = await offerService.updateOffer(req.params.id, req.body);
  sendSuccess(res, offer, 'Offer updated');
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  await offerService.deleteOffer(req.params.id);
  sendSuccess(res, null, 'Offer deleted');
});

export const updateStatus = catchAsync(async (req: Request, res: Response) => {
  const offer = await offerService.updateOfferStatus(req.params.id, req.body.status);
  sendSuccess(res, offer, 'Offer status updated');
});

export const active = catchAsync(async (req: Request, res: Response) => {
  const offers = await offerService.listActiveOffers({
    locationId: req.query.locationId as string | undefined,
    businessType: req.query.businessType as string | undefined,
    vendorId: req.query.vendorId as string | undefined,
    storeId: req.query.storeId as string | undefined,
  });
  sendSuccess(res, offers);
});
