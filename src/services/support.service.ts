import { SupportTicket } from '../models/SupportTicket';
import { SupportFaq } from '../models/SupportFaq';
import { SupportConfig, ISupportCategory } from '../models/SupportConfig';
import { Order } from '../models/Order';
import { Customer } from '../models/Customer';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import {
  GENERIC_STATUS,
  NOTIFICATION_TYPES,
  SUPPORT_MESSAGE_SENDER,
  SUPPORT_TICKET_STATUS,
} from '../constants/enums';
import * as notificationService from './notification.service';

// Used until an admin saves their own settings — so the app's Help screen
// is never empty on a fresh install.
export const DEFAULT_SUPPORT_CATEGORIES: ISupportCategory[] = [
  { key: 'ORDER', label: 'Order issue', description: 'Status, delays or changes to an order', icon: 'receipt-outline', orderScoped: true, displayOrder: 1, active: true },
  { key: 'PAYMENT', label: 'Payment issue', description: 'Charged but order failed, double charge', icon: 'card-outline', orderScoped: true, displayOrder: 2, active: true },
  { key: 'REFUND', label: 'Refund', description: 'Track or request a refund', icon: 'cash-outline', orderScoped: true, displayOrder: 3, active: true },
  { key: 'MISSING_ITEM', label: 'Missing item', description: 'Something was not in your bag', icon: 'cube-outline', orderScoped: true, displayOrder: 4, active: true },
  { key: 'WRONG_ITEM', label: 'Wrong item', description: 'Received something you did not order', icon: 'swap-horizontal-outline', orderScoped: true, displayOrder: 5, active: true },
  { key: 'DAMAGED', label: 'Damaged or spilled', description: 'Poor packaging, spilled or broken', icon: 'alert-circle-outline', orderScoped: true, displayOrder: 6, active: true },
  { key: 'DELIVERY', label: 'Delivery issue', description: 'Rider behaviour, wrong address, late', icon: 'bicycle-outline', orderScoped: true, displayOrder: 7, active: true },
  { key: 'ACCOUNT', label: 'Account & login', description: 'Profile, phone number, sign-in', icon: 'person-circle-outline', orderScoped: false, displayOrder: 8, active: true },
  { key: 'OTHER', label: 'Something else', description: 'Feedback or anything not listed', icon: 'chatbubbles-outline', orderScoped: false, displayOrder: 9, active: true },
];

const DEFAULT_CONFIG = {
  email: 'support@buddy4study.com',
  phone: '+91-8929555555',
  whatsapp: '',
  hours: 'Every day, 9 AM – 11 PM',
  responseTime: 'Usually replies within 2 hours',
  notice: '',
};

// ── settings ────────────────────────────────────────────────────────────
export async function getSupportConfig(includeInactive = false) {
  const doc = await SupportConfig.findOne({ key: 'default' });
  const base = doc ? doc.toJSON() : { key: 'default', ...DEFAULT_CONFIG, categories: DEFAULT_SUPPORT_CATEGORIES };
  const categories = (base.categories?.length ? base.categories : DEFAULT_SUPPORT_CATEGORIES)
    .filter((c: ISupportCategory) => includeInactive || c.active !== false)
    .sort((a: ISupportCategory, b: ISupportCategory) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  return { ...base, categories };
}

export async function updateSupportConfig(data: Record<string, unknown>) {
  if (Array.isArray(data.categories)) {
    const keys = (data.categories as ISupportCategory[]).map((c) => c.key);
    if (new Set(keys).size !== keys.length) throw ApiError.badRequest('Category keys must be unique', 'DUPLICATE_CATEGORY_KEY');
  }
  await SupportConfig.findOneAndUpdate({ key: 'default' }, { ...data, key: 'default' }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return getSupportConfig(true);
}

// ── FAQs ──────────────────────────────────────────────────────────────
export async function listPublicFaqs(category?: string) {
  const filter: Record<string, unknown> = { status: GENERIC_STATUS.ACTIVE };
  if (category) filter.category = category;
  return SupportFaq.find(filter).sort({ displayOrder: 1, createdAt: 1 }).limit(100);
}

export async function listFaqs(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    SupportFaq.find(filter).sort({ displayOrder: 1, createdAt: 1 }).skip(pagination.skip).limit(pagination.limit),
    SupportFaq.countDocuments(filter),
  ]);
  return { items, total };
}

export const createFaq = (data: Record<string, unknown>) => SupportFaq.create(data);

async function findFaqOrThrow(id: string) {
  const faq = await SupportFaq.findById(id);
  if (!faq) throw ApiError.notFound('FAQ not found', 'FAQ_NOT_FOUND');
  return faq;
}

export async function updateFaq(id: string, data: Record<string, unknown>) {
  const faq = await findFaqOrThrow(id);
  Object.assign(faq, data);
  await faq.save();
  return faq;
}

export async function deleteFaq(id: string) {
  const faq = await findFaqOrThrow(id);
  await faq.deleteOne();
}

// ── tickets (customer) ────────────────────────────────────────────────
function newTicketNumber() {
  return `SUP${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 36 ** 2).toString(36).toUpperCase().padStart(2, '0')}`;
}

export async function createTicket(
  user: JwtPayload,
  data: { category: string; subject?: string; message: string; orderId?: string; images?: string[] },
) {
  const config = await getSupportConfig(false);
  const category = config.categories.find((c: ISupportCategory) => c.key === data.category);
  if (!category) throw ApiError.badRequest('Unknown support category', 'SUPPORT_CATEGORY_INVALID');

  let orderNumber: string | undefined;
  if (data.orderId) {
    const order = await Order.findById(data.orderId).select('customerId orderNumber');
    if (!order || order.customerId.toString() !== user.userId) {
      throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');
    }
    orderNumber = order.orderNumber;
  } else if (category.orderScoped) {
    throw ApiError.badRequest('Please choose the order this is about', 'SUPPORT_ORDER_REQUIRED');
  }

  const customer = await Customer.findById(user.userId).select('name phone');
  const subject = (data.subject?.trim() || `${category.label}${orderNumber ? ` · #${orderNumber.slice(-8)}` : ''}`).slice(0, 160);

  return SupportTicket.create({
    ticketNumber: newTicketNumber(),
    customerId: user.userId,
    category: category.key,
    categoryLabel: category.label,
    subject,
    orderId: data.orderId,
    orderNumber,
    status: SUPPORT_TICKET_STATUS.OPEN,
    messages: [
      {
        sender: SUPPORT_MESSAGE_SENDER.CUSTOMER,
        senderId: user.userId,
        senderName: customer?.name || customer?.phone || 'Customer',
        text: data.message.trim(),
        images: data.images ?? [],
      },
    ],
    lastMessageAt: new Date(),
    lastMessageBy: SUPPORT_MESSAGE_SENDER.CUSTOMER,
    adminUnread: true,
    customerUnread: false,
  });
}

export async function listMyTickets(user: JwtPayload, pagination: PaginationParams, status?: string) {
  const filter: Record<string, unknown> = { customerId: user.userId };
  if (status === 'OPEN') filter.status = { $nin: [SUPPORT_TICKET_STATUS.RESOLVED, SUPPORT_TICKET_STATUS.CLOSED] };
  else if (status === 'CLOSED') filter.status = { $in: [SUPPORT_TICKET_STATUS.RESOLVED, SUPPORT_TICKET_STATUS.CLOSED] };
  const [items, total, unread] = await Promise.all([
    SupportTicket.find(filter).select('-messages').sort({ lastMessageAt: -1 }).skip(pagination.skip).limit(pagination.limit),
    SupportTicket.countDocuments(filter),
    SupportTicket.countDocuments({ customerId: user.userId, customerUnread: true }),
  ]);
  return { items, total, unread };
}

async function findTicketOrThrow(id: string) {
  const ticket = await SupportTicket.findById(id);
  if (!ticket) throw ApiError.notFound('Ticket not found', 'SUPPORT_TICKET_NOT_FOUND');
  return ticket;
}

async function findOwnTicket(id: string, user: JwtPayload) {
  const ticket = await findTicketOrThrow(id);
  if (ticket.customerId.toString() !== user.userId) {
    throw ApiError.forbidden('You do not have access to this ticket', 'SUPPORT_TICKET_FORBIDDEN');
  }
  return ticket;
}

export async function getMyTicket(id: string, user: JwtPayload) {
  const ticket = await findOwnTicket(id, user);
  if (ticket.customerUnread) {
    ticket.customerUnread = false;
    await ticket.save();
  }
  return ticket;
}

export async function customerReply(id: string, user: JwtPayload, data: { text: string; images?: string[] }) {
  const ticket = await findOwnTicket(id, user);
  if (ticket.status === SUPPORT_TICKET_STATUS.CLOSED) {
    throw ApiError.unprocessable('This ticket is closed — please open a new one', 'SUPPORT_TICKET_CLOSED');
  }
  const customer = await Customer.findById(user.userId).select('name phone');
  ticket.messages.push({
    sender: SUPPORT_MESSAGE_SENDER.CUSTOMER,
    senderId: user.userId,
    senderName: customer?.name || customer?.phone || 'Customer',
    text: data.text.trim(),
    images: data.images ?? [],
  } as never);
  // a reply on a resolved / waiting ticket reopens it
  if (ticket.status === SUPPORT_TICKET_STATUS.RESOLVED || ticket.status === SUPPORT_TICKET_STATUS.AWAITING_CUSTOMER) {
    ticket.status = SUPPORT_TICKET_STATUS.OPEN;
    ticket.resolvedAt = undefined;
  }
  ticket.lastMessageAt = new Date();
  ticket.lastMessageBy = SUPPORT_MESSAGE_SENDER.CUSTOMER;
  ticket.adminUnread = true;
  await ticket.save();
  return ticket;
}

export async function customerClose(id: string, user: JwtPayload, rating?: number) {
  const ticket = await findOwnTicket(id, user);
  ticket.status = SUPPORT_TICKET_STATUS.CLOSED;
  ticket.resolvedAt = ticket.resolvedAt ?? new Date();
  if (rating) ticket.rating = rating;
  ticket.messages.push({
    sender: SUPPORT_MESSAGE_SENDER.SYSTEM,
    text: rating ? `Customer closed the ticket and rated support ${rating}/5.` : 'Customer closed the ticket.',
    images: [],
  } as never);
  ticket.lastMessageAt = new Date();
  await ticket.save();
  return ticket;
}

// ── tickets (admin) ───────────────────────────────────────────────────
export async function listTickets(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total, counts] = await Promise.all([
    SupportTicket.find(filter)
      .select('-messages')
      .populate('customerId', 'name phone email')
      .sort({ adminUnread: -1, lastMessageAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit),
    SupportTicket.countDocuments(filter),
    SupportTicket.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  const byStatus = Object.fromEntries(counts.map((c: { _id: string; count: number }) => [c._id, c.count]));
  return { items, total, byStatus };
}

export async function getTicketForAdmin(id: string) {
  const ticket = await SupportTicket.findById(id).populate('customerId', 'name phone email');
  if (!ticket) throw ApiError.notFound('Ticket not found', 'SUPPORT_TICKET_NOT_FOUND');
  if (ticket.adminUnread) {
    ticket.adminUnread = false;
    await ticket.save();
  }
  return ticket;
}

export async function adminReply(
  id: string,
  admin: JwtPayload & { name?: string },
  data: { text: string; images?: string[]; status?: string },
) {
  const ticket = await findTicketOrThrow(id);
  ticket.messages.push({
    sender: SUPPORT_MESSAGE_SENDER.ADMIN,
    senderId: admin.userId,
    senderName: 'Support team',
    text: data.text.trim(),
    images: data.images ?? [],
  } as never);
  ticket.status = data.status ?? SUPPORT_TICKET_STATUS.AWAITING_CUSTOMER;
  if (ticket.status === SUPPORT_TICKET_STATUS.RESOLVED) ticket.resolvedAt = new Date();
  ticket.lastMessageAt = new Date();
  ticket.lastMessageBy = SUPPORT_MESSAGE_SENDER.ADMIN;
  ticket.customerUnread = true;
  ticket.adminUnread = false;
  await ticket.save();

  await notificationService
    .notify(
      ticket.customerId.toString(),
      'CUSTOMER',
      NOTIFICATION_TYPES.SUPPORT_UPDATE,
      'Support replied to your ticket',
      data.text.trim().slice(0, 140),
      { ticketId: ticket.id, ticketNumber: ticket.ticketNumber },
    )
    .catch(() => {});
  return ticket;
}

export async function updateTicket(id: string, data: { status?: string; priority?: string; assignedTo?: string | null }) {
  const ticket = await findTicketOrThrow(id);
  const prevStatus = ticket.status;
  if (data.priority) ticket.priority = data.priority;
  if (data.assignedTo !== undefined) ticket.assignedTo = (data.assignedTo ?? undefined) as never;
  if (data.status && data.status !== prevStatus) {
    ticket.status = data.status;
    if (data.status === SUPPORT_TICKET_STATUS.RESOLVED) ticket.resolvedAt = new Date();
    ticket.messages.push({
      sender: SUPPORT_MESSAGE_SENDER.SYSTEM,
      text: `Status changed to ${data.status.replace(/_/g, ' ').toLowerCase()}.`,
      images: [],
    } as never);
    ticket.lastMessageAt = new Date();
    ticket.customerUnread = true;
  }
  await ticket.save();

  if (data.status && data.status !== prevStatus && [SUPPORT_TICKET_STATUS.RESOLVED, SUPPORT_TICKET_STATUS.CLOSED].includes(data.status as never)) {
    await notificationService
      .notify(
        ticket.customerId.toString(),
        'CUSTOMER',
        NOTIFICATION_TYPES.SUPPORT_UPDATE,
        data.status === SUPPORT_TICKET_STATUS.RESOLVED ? 'Your ticket was resolved' : 'Your ticket was closed',
        `Ticket #${ticket.ticketNumber}: ${ticket.subject}`,
        { ticketId: ticket.id, ticketNumber: ticket.ticketNumber },
      )
      .catch(() => {});
  }
  return ticket;
}
