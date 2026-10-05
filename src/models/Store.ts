import { Schema, model, Document, Types } from 'mongoose';
import { STORE_STATUS, STORE_APPROVAL_STATUS, PRICING_MODELS } from '../constants/enums';
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
  // How far (km) from its own latitude/longitude the store delivers — same
  // rule as a Vendor's serviceRadius: customers beyond it don't see the store
  // and can't order from it.
  serviceRadius: number;
  status: string;
  // Onboarding/approval workflow — see STORE_APPROVAL_STATUS. Separate from
  // `status`, which is the operational open/closed-for-business signal.
  approvalStatus: string;
  // Pricing model (see PRICING_MODELS) — COMMISSION by default. Under MARKUP
  // there is no seller-level markup: each product carries its own markupPercent
  // (see VendorFoodItem / InstamartProduct).
  pricingModel: string;
  // Commission % the platform keeps when pricingModel is COMMISSION — set once
  // on the store profile (never per product). Unset on stores that still rely
  // on the older Commission rules.
  commissionPercent?: number;
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
    serviceRadius: { type: Number, default: 5, min: 0 },
    status: { type: String, enum: Object.values(STORE_STATUS), default: STORE_STATUS.ACTIVE },
    approvalStatus: { type: String, enum: Object.values(STORE_APPROVAL_STATUS), default: STORE_APPROVAL_STATUS.PENDING },
    pricingModel: { type: String, enum: Object.values(PRICING_MODELS), default: PRICING_MODELS.COMMISSION },
    commissionPercent: { type: Number, min: 0, max: 100 },
    openingTime: { type: String, default: '09:00' },
    closingTime: { type: String, default: '22:00' },
    rating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

storeSchema.index({ locationId: 1, status: 1 });
storeSchema.index({ name: 'text' });
hidePasswordInJson(storeSchema);

export const Store = model<IStore>('Store', storeSchema);
