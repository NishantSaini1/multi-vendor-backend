import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { MulterError } from 'multer';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';
import { env } from '../config/env';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`, 'ROUTE_NOT_FOUND'));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors: err.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors: Object.values(err.errors).map((e) => ({ field: e.path, message: e.message })),
    });
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({
      success: false,
      message: `Invalid value for field "${err.path}"`,
      error: { code: 'INVALID_ID' },
    });
    return;
  }

  if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: number }).code === 11000) {
    const keyValue = (err as { keyValue?: Record<string, unknown> }).keyValue ?? {};
    res.status(409).json({
      success: false,
      message: `Duplicate value for ${Object.keys(keyValue).join(', ')}`,
      error: { code: 'DUPLICATE_KEY' },
    });
    return;
  }

  if (err instanceof MulterError) {
    res.status(400).json({
      success: false,
      message: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 5MB)' : err.message,
      error: { code: `UPLOAD_${err.code}` },
    });
    return;
  }

  if (err instanceof ApiError) {
    if (!err.isOperational) {
      logger.error({ err }, 'Non-operational ApiError');
    }
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      error: { code: err.code, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }

  logger.error({ err, path: req.originalUrl, method: req.method }, 'Unhandled error');

  res.status(500).json({
    success: false,
    message: env.isProduction ? 'Internal server error' : (err as Error)?.message || 'Internal server error',
    error: { code: 'INTERNAL_SERVER_ERROR' },
  });
}
