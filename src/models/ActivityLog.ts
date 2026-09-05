import { Schema, model, Document, Types } from 'mongoose';
import { UserType } from '../constants/roles';

export interface IActivityLog extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  userType: UserType;
  action: string;
  module: string;
  entityType: string;
  entityId?: Types.ObjectId;
  locationId?: Types.ObjectId;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
  updatedAt: Date;
}

const activityLogSchema = new Schema<IActivityLog>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, index: true },
    userType: { type: String, required: true },
    action: { type: String, required: true },
    module: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', index: true },
    oldData: { type: Schema.Types.Mixed },
    newData: { type: Schema.Types.Mixed },
    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: true },
);

activityLogSchema.index({ createdAt: -1 });

export const ActivityLog = model<IActivityLog>('ActivityLog', activityLogSchema);
