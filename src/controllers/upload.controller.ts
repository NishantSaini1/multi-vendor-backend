import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess } from '../utils/ApiResponse';
import { ApiError } from '../utils/ApiError';
import * as uploadService from '../services/upload.service';

export const create = catchAsync(async (req: Request, res: Response) => {
  if (!req.file) throw ApiError.badRequest('No image file was provided (field name: "image")', 'FILE_REQUIRED');
  const result = await uploadService.uploadImageBuffer(req.file.buffer);
  sendSuccess(res, result, 'Image uploaded', 201);
});

export const remove = catchAsync(async (req: Request, res: Response) => {
  const publicId = req.query.publicId as string;
  if (!publicId) throw ApiError.badRequest('publicId is required', 'PUBLIC_ID_REQUIRED');
  await uploadService.deleteImage(publicId);
  sendSuccess(res, null, 'Image deleted');
});
