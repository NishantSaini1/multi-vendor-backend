import { z } from 'zod';
import { GENERIC_STATUS, SUPPORT_TICKET_PRIORITY, SUPPORT_TICKET_STATUS } from '../constants/enums';

const objectId = z.string().length(24);
const images = z.array(z.string().url()).max(5).default([]);

export const supportIdParamSchema = z.object({ params: z.object({ id: objectId }) });

export const publicFaqsQuerySchema = z.object({
  query: z.object({ category: z.string().max(40).optional() }),
});

// ── customer ──
export const createTicketSchema = z.object({
  body: z.object({
    category: z.string().min(1).max(40),
    subject: z.string().trim().max(160).optional(),
    message: z.string().trim().min(5, 'Please describe the issue (at least 5 characters)').max(4000),
    orderId: objectId.optional(),
    images,
  }),
});

export const myTicketsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    status: z.enum(['OPEN', 'CLOSED']).optional(),
  }),
});

export const replyTicketSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ text: z.string().trim().min(1).max(4000), images }),
});

export const closeTicketSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ rating: z.number().int().min(1).max(5).optional() }),
});

// ── admin ──
const statusEnum = z.enum(Object.values(SUPPORT_TICKET_STATUS) as [string, ...string[]]);

export const adminTicketsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    status: statusEnum.optional(),
    category: z.string().max(40).optional(),
    search: z.string().max(80).optional(),
  }),
});

export const adminReplySchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ text: z.string().trim().min(1).max(4000), images, status: statusEnum.optional() }),
});

export const adminUpdateTicketSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    status: statusEnum.optional(),
    priority: z.enum(Object.values(SUPPORT_TICKET_PRIORITY) as [string, ...string[]]).optional(),
    assignedTo: objectId.nullable().optional(),
  }),
});

const faqBody = z.object({
  question: z.string().trim().min(3).max(300),
  answer: z.string().trim().min(1).max(4000),
  category: z.string().max(40).optional().or(z.literal('')),
  displayOrder: z.number().int().default(0),
  status: z.enum(Object.values(GENERIC_STATUS) as [string, ...string[]]).default(GENERIC_STATUS.ACTIVE),
});

export const createFaqSchema = z.object({ body: faqBody });
export const updateFaqSchema = z.object({ params: z.object({ id: objectId }), body: faqBody.partial() });
export const listFaqsQuerySchema = z.object({
  query: z.object({ page: z.string().optional(), limit: z.string().optional(), category: z.string().optional() }),
});

export const updateConfigSchema = z.object({
  body: z.object({
    email: z.string().email().or(z.literal('')).optional(),
    phone: z.string().max(30).optional(),
    whatsapp: z.string().max(30).optional(),
    hours: z.string().max(120).optional(),
    responseTime: z.string().max(120).optional(),
    notice: z.string().max(300).optional(),
    categories: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(40).regex(/^[A-Z0-9_]+$/, 'Use UPPER_CASE letters, digits and _'),
          label: z.string().trim().min(1).max(60),
          description: z.string().max(140).optional(),
          icon: z.string().max(60).default('help-circle-outline'),
          orderScoped: z.boolean().default(false),
          displayOrder: z.number().int().default(0),
          active: z.boolean().default(true),
        }),
      )
      .max(30)
      .optional(),
  }),
});
