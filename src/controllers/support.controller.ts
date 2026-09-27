import { Request, Response } from 'express';
import { catchAsync } from '../utils/catchAsync';
import { sendSuccess, buildPagination } from '../utils/ApiResponse';
import { parsePagination } from '../utils/pagination';
import { ApiError } from '../utils/ApiError';
import * as supportService from '../services/support.service';

function requireUser(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

// ── public ──
export const config = catchAsync(async (_req: Request, res: Response) => {
  sendSuccess(res, await supportService.getSupportConfig(false));
});

export const publicFaqs = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await supportService.listPublicFaqs(req.query.category as string | undefined));
});

// ── customer ──
export const createTicket = catchAsync(async (req: Request, res: Response) => {
  const ticket = await supportService.createTicket(requireUser(req), req.body);
  sendSuccess(res, ticket, 'Ticket created', 201);
});

export const myTickets = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const { items, total, unread } = await supportService.listMyTickets(
    requireUser(req),
    pagination,
    req.query.status as string | undefined,
  );
  res.status(200).json({
    success: true,
    message: 'Success',
    data: items,
    pagination: buildPagination(pagination.page, pagination.limit, total),
    meta: { unread },
  });
});

export const myTicket = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await supportService.getMyTicket(req.params.id, requireUser(req)));
});

export const customerReply = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await supportService.customerReply(req.params.id, requireUser(req), req.body), 'Reply sent');
});

export const customerClose = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await supportService.customerClose(req.params.id, requireUser(req), req.body.rating), 'Ticket closed');
});

// ── admin ──
export const adminTickets = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.category) filter.category = req.query.category;
  if (req.query.search) {
    const rx = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ ticketNumber: rx }, { subject: rx }, { orderNumber: rx }];
  }
  const { items, total, byStatus } = await supportService.listTickets(filter, pagination);
  res.status(200).json({
    success: true,
    message: 'Success',
    data: items,
    pagination: buildPagination(pagination.page, pagination.limit, total),
    meta: { byStatus },
  });
});

export const adminTicket = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await supportService.getTicketForAdmin(req.params.id));
});

export const adminReply = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await supportService.adminReply(req.params.id, requireUser(req), req.body), 'Reply sent');
});

export const adminUpdateTicket = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await supportService.updateTicket(req.params.id, req.body), 'Ticket updated');
});

export const adminConfig = catchAsync(async (_req: Request, res: Response) => {
  sendSuccess(res, await supportService.getSupportConfig(true));
});

export const updateConfig = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await supportService.updateSupportConfig(req.body), 'Support settings saved');
});

export const listFaqs = catchAsync(async (req: Request, res: Response) => {
  const pagination = parsePagination(req);
  const filter: Record<string, unknown> = {};
  if (req.query.category) filter.category = req.query.category;
  const { items, total } = await supportService.listFaqs(filter, pagination);
  sendSuccess(res, items, 'Success', 200, buildPagination(pagination.page, pagination.limit, total));
});

export const createFaq = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await supportService.createFaq(req.body), 'FAQ created', 201);
});

export const updateFaq = catchAsync(async (req: Request, res: Response) => {
  sendSuccess(res, await supportService.updateFaq(req.params.id, req.body), 'FAQ updated');
});

export const deleteFaq = catchAsync(async (req: Request, res: Response) => {
  await supportService.deleteFaq(req.params.id);
  sendSuccess(res, null, 'FAQ deleted');
});
