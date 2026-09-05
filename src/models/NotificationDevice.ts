import { Schema, model, Document, Types } from 'mongoose';
import { DEVICE_TYPES } from '../constants/enums';
import { UserType } from '../constants/roles';

// Backs POST /notifications/register-device and DELETE /notifications/device/:id.
// `playerId` is OneSignal's own per-device subscription identifier (obtained
// client-side by the OneSignal SDK) — the push provider, not us, owns the
// underlying platform token (APNs/FCM/web push); we just need to remember
// which OneSignal player ids belong to which user so notification.service
// can target them.
export interface INotificationDevice extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  userType: UserType;
  playerId: string;
  deviceType: string;
  deviceId: string;
  createdAt: Date;
  updatedAt: Date;
}

const notificationDeviceSchema = new Schema<INotificationDevice>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    userType: { type: String, required: true },
    playerId: { type: String, required: true },
    deviceType: { type: String, enum: Object.values(DEVICE_TYPES), required: true },
    deviceId: { type: String, required: true },
  },
  { timestamps: true },
);

notificationDeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

export const NotificationDevice = model<INotificationDevice>('NotificationDevice', notificationDeviceSchema);
