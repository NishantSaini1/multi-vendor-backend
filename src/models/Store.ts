import { Schema, model, Document, Types } from 'mongoose';
import { STORE_STATUS, STORE_APPROVAL_STATUS } from '../constants/enums';
import { hidePasswordInJson } from '../utils/schemaSecurity';

export interface IStore extends Document {
  _id: Types.ObjectId;
  locationId: Types.ObjectId;
  // Which of the location's delivery zones this store belongs to (Location ->
  // Zone -> Store). Resolved server-side from latitude/longitude, never set
  // directly by the client — see store.service.ts.
  deliveryZoneId: Types.ObjectId;
  // Store specialization(s) (Grocery, Fruits & Vegetables, Cosmetics, ...) —
  // admin-managed StoreType entities, not a hardcoded enum (see
  // models/StoreType.ts). A store may support more than one type (e.g. a
  // Supermarket carrying both Grocery and Bakery & Dairy); this also
  // determines which global categories the store can list products under
  // (see InstamartCategory.storeTypeIds).
  storeTypeIds: Types.ObjectId[];
  name: string;
  managerName: string;
  phone: string;
  email?: string;
  password: string;
  logo?: string;
  address: string;
  latitude: number;
  longitude: number;
  status: string;
  // Onboarding/approval workflow — see STORE_APPROVAL_STATUS. Separate from
  // `status`, which is the operational open/closed-for-business signal.
  approvalStatus: string;
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
    deliveryZoneId: { type: Schema.Types.ObjectId, ref: 'DeliveryZone', required: true, index: true },
    storeTypeIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'StoreType' }],
      required: true,
      validate: {
        validator: (v: unknown[]) => Array.isArray(v) && v.length > 0,
        message: 'A store must have at least one storeTypeId',
      },
    },
    name: { type: String, required: true, trim: true },
    managerName: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    email: { type: String, lowercase: true, trim: true, sparse: true, unique: true },
    password: { type: String, required: true, select: false },
    logo: { type: String },
    address: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    status: { type: String, enum: Object.values(STORE_STATUS), default: STORE_STATUS.ACTIVE },
    approvalStatus: { type: String, enum: Object.values(STORE_APPROVAL_STATUS), default: STORE_APPROVAL_STATUS.PENDING },
    openingTime: { type: String, default: '09:00' },
    closingTime: { type: String, default: '22:00' },
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

storeSchema.index({ locationId: 1, status: 1 });
// At most one store carrying a given type in a given zone — a multikey index
// (storeTypeIds is an array), so this generates one index entry per
// (deliveryZoneId, individual storeTypeId) pair, correctly catching overlap
// between two stores' type arrays, not just an exact-array match. Enforced
// here as the race-safe source of truth, and pre-checked in store.service.ts
// for a clear error message before hitting this constraint.
storeSchema.index({ deliveryZoneId: 1, storeTypeIds: 1 }, { unique: true });
storeSchema.index({ name: 'text' });
hidePasswordInJson(storeSchema);

export const Store = model<IStore>('Store', storeSchema);
