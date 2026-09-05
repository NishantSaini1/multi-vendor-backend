export class ApiError extends Error {
  public statusCode: number;
  public code: string;
  public isOperational: boolean;
  public details?: unknown;

  constructor(statusCode: number, message: string, code = 'ERROR', details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: unknown) {
    return new ApiError(400, message, code, details);
  }

  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    return new ApiError(401, message, code);
  }

  static forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
    return new ApiError(403, message, code);
  }

  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new ApiError(404, message, code);
  }

  static conflict(message: string, code = 'CONFLICT') {
    return new ApiError(499, message, code);
  }

  static unprocessable(message: string, code = 'UNPROCESSABLE_ENTITY', details?: unknown) {
    return new ApiError(422, message, code, details);
  }

  static tooManyRequests(message = 'Too many requests', code = 'TOO_MANY_REQUESTS') {
    return new ApiError(429, message, code);
  }

  static internal(message = 'Internal server error', code = 'INTERNAL_SERVER_ERROR') {
    return new ApiError(500, message, code);
  }
}
