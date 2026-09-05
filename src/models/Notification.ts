import { Schema, model, Document, Types } from 'mongoose';
import { NOTIFICATION_TYPES } from '../constants/enums';
import { UserType } from '../constants/roles';

export const NOTIFICATION_PUSH_STATUS = {
  // No push was attempted — OneSignal wasn't configured, or the user had no
  // registered devices at send time. Nothing for the retry job to do.
  SKIPPED: 'SKIPPED',
  SENT: 'SENT',
  FAILED: 'FAILED',
} as const;

export interface INotification extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  userType: UserType;
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  readAt?: Date;
  pushStatus: string;
  pushAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    userType: { type: String, required: true },
    type: { type: String, enum: Object.values(NOTIFICATION_TYPES), required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: Schema.Types.Mixed },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date },
    pushStatus: { type: String, enum: Object.values(NOTIFICATION_PUSH_STATUS), default: NOTIFICATION_PUSH_STATUS.SKIPPED },
    pushAttempts: { type: Number, default: 0 },
  },
  { timestamps: true },
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ pushStatus: 1, createdAt: -1 });

export const Notification = model<INotification>('Notification', notificationSchema);
