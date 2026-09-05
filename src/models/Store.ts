import { Schema, model, Document, Types } from 'mongoose';
import { STORE_STATUS } from '../constants/enums';

// Store has no login of its own — the spec's auth section only defines
// Customer/Vendor/DeliveryPartner/Admin. Stores are managed entirely through
// the Admin Panel (see storeAuth module note in README.md if that changes).
export interface IStore extends Document {
  _id: Types.ObjectId;
  locationId: Types.ObjectId;
  name: string;
  managerName: string;
  phone: string;
  email?: string;
  logo?: string;
  address: string;
  latitude: number;
  longitude: number;
  status: string;
  openingTime: string;
  closingTime: string;
  rating: number;
  ratingCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const storeSchema = new Schema<IStore>(
  {
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    name: { type: String, required: true, trim: true },
    managerName: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    email: { type: String, lowercase: true, trim: true, sparse: true, unique: true },
    logo: { type: String },
    address: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    status: { type: String, enum: Object.values(STORE_STATUS), default: STORE_STATUS.ACTIVE },
    openingTime: { type: String, default: '09:00' },
    closingTime: { type: String, default: '22:00' },
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

storeSchema.index({ locationId: 1, status: 1 });
storeSchema.index({ name: 'text' });

export const Store = model<IStore>('Store', storeSchema);
