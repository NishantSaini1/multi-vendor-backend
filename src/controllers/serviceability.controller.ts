import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { checkServiceability } from '../services/serviceability.service';

export const check = catchAsync(async (req: Request, res: Response) => {
  const { latitude, longitude, businessType, vendorId, storeId } = req.body;
  const result = await checkServiceability(latitude, longitude, businessType, { vendorId, storeId });
  sendSuccess(res, result);
});
