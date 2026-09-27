import { Schema, model, Document, Types } from 'mongoose';
import { SUPPORT_MESSAGE_SENDER, SUPPORT_TICKET_PRIORITY, SUPPORT_TICKET_STATUS } from '../constants/enums';

export interface ISupportMessage {
  _id: Types.ObjectId;
  sender: string; // CUSTOMER | ADMIN | SYSTEM
  senderId?: Types.ObjectId;
  senderName?: string;
  text: string;
  images: string[];
  createdAt: Date;
}

// A customer help-desk conversation. `category` is one of the keys from
// SupportConfig.categories (kept as a plain string so admins can add
// categories without a code change); `orderId` links order-scoped issues.
export interface ISupportTicket extends Document {
  _id: Types.ObjectId;
  ticketNumber: string;
  customerId: Types.ObjectId;
  category: string;
  categoryLabel: string;
  subject: string;
  orderId?: Types.ObjectId;
  orderNumber?: string;
  status: string;
  priority: string;
  messages: ISupportMessage[];
  lastMessageAt: Date;
  lastMessageBy: string;
  // unread flags for each side
  customerUnread: boolean;
  adminUnread: boolean;
  assignedTo?: Types.ObjectId;
  resolvedAt?: Date;
  rating?: number;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<ISupportMessage>(
  {
    sender: { type: String, enum: Object.values(SUPPORT_MESSAGE_SENDER), required: true },
    senderId: { type: Schema.Types.ObjectId },
    senderName: { type: String },
    text: { type: String, required: true, maxlength: 4000 },
    images: { type: [String], default: [] },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const supportTicketSchema = new Schema<ISupportTicket>(
  {
    ticketNumber: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    category: { type: String, required: true, index: true },
    categoryLabel: { type: String, required: true },
    subject: { type: String, required: true, maxlength: 160 },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', index: true },
    orderNumber: { type: String },
    status: { type: String, enum: Object.values(SUPPORT_TICKET_STATUS), default: SUPPORT_TICKET_STATUS.OPEN, index: true },
    priority: { type: String, enum: Object.values(SUPPORT_TICKET_PRIORITY), default: SUPPORT_TICKET_PRIORITY.NORMAL },
    messages: { type: [messageSchema], default: [] },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessageBy: { type: String, default: SUPPORT_MESSAGE_SENDER.CUSTOMER },
    customerUnread: { type: Boolean, default: false },
    adminUnread: { type: Boolean, default: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'AdminUser' },
    resolvedAt: { type: Date },
    rating: { type: Number, min: 1, max: 5 },
  },
  { timestamps: true },
);

supportTicketSchema.index({ customerId: 1, lastMessageAt: -1 });

export const SupportTicket = model<ISupportTicket>('SupportTicket', supportTicketSchema);
