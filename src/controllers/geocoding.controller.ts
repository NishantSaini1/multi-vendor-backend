import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import * as geocodingService from '../services/geocoding.service';

export const search = catchAsync(async (req: Request, res: Response) => {
  const results = await geocodingService.geocodeSearch(req.query.q as string);
  sendSuccess(res, results);
});

export const reverse = catchAsync(async (req: Request, res: Response) => {
  const result = await geocodingService.geocodeReverse(Number(req.query.latitude), Number(req.query.longitude));
  sendSuccess(res, result);
});
