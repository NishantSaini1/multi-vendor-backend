import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { checkServiceability } from '../services/serviceability.service';

export const check = catchAsync(async (req: Request, res: Response) => {
  const { latitude, longitude, businessType } = req.body;
  const result = await checkServiceability(latitude, longitude, businessType);
  sendSuccess(res, result);
});
