import { Schema, model, Document, Types } from 'mongoose';
import { ADMIN_ROLES } from '../constants/roles';
import { CUSTOMER_STATUS } from '../constants/enums';
import { hidePasswordInJson } from '../utils/schemaSecurity';

export interface IAdminUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: string;
  locationIds: Types.ObjectId[];
  profileImage?: string;
  status: string;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const adminUserSchema = new Schema<IAdminUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: Object.values(ADMIN_ROLES), required: true },
    locationIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Location' }], default: [] },
    profileImage: { type: String },
    status: { type: String, enum: Object.values(CUSTOMER_STATUS), default: CUSTOMER_STATUS.ACTIVE },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

adminUserSchema.index({ role: 1 });
adminUserSchema.index({ locationIds: 1 });
hidePasswordInJson(adminUserSchema);

export const AdminUser = model<IAdminUser>('AdminUser', adminUserSchema);
