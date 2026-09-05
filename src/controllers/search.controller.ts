import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import * as searchService from '../services/search.service';

export const search = catchAsync(async (req: Request, res: Response) => {
  const results = await searchService.search(req.query.q as string, {
    locationId: req.query.locationId as string | undefined,
    businessType: req.query.businessType as string | undefined,
  });
  sendSuccess(res, results);
});
