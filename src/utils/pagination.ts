import { Request } from 'express';

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
  sort: Record<string, 1 | -1>;
}

export function parsePagination(req: Request, defaultSort: Record<string, 1 | -1> = { createdAt: -1 }): PaginationParams {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
  const skip = (page - 1) * limit;

  let sort = defaultSort;
  if (typeof req.query.sort === 'string' && req.query.sort.length > 0) {
    sort = {};
    for (const field of req.query.sort.split(',')) {
      if (field.startsWith('-')) {
        sort[field.slice(1)] = -1;
      } else {
        sort[field] = 1;
      }
    }
  }

  return { page, limit, skip, sort };
}
