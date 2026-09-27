import { Schema, model, Document, Types } from 'mongoose';

export const FAVORITE_TYPES = {
  VENDOR: 'VENDOR',
  STORE: 'STORE',
  // a Food VendorFoodItem or an InstamartProduct — meta.businessType says which
  PRODUCT: 'PRODUCT',
} as const;

// A customer's saved restaurant / store / product, synced across devices.
// `name` / `image` are a snapshot for fast rendering; GET /favorites also
// attaches live status (open, price, availability) from the source record.
export interface ICustomerFavorite extends Document {
  _id: Types.ObjectId;
  customerId: Types.ObjectId;
  type: string;
  targetId: Types.ObjectId;
  name: string;
  image?: string;
  meta?: { businessType?: 'FOOD' | 'INSTAMART'; vendorId?: string; storeId?: string; sellerName?: string };
  createdAt: Date;
  updatedAt: Date;
}

const customerFavoriteSchema = new Schema<ICustomerFavorite>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    type: { type: String, enum: Object.values(FAVORITE_TYPES), required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, maxlength: 200 },
    image: { type: String },
    meta: {
      businessType: { type: String, enum: ['FOOD', 'INSTAMART'] },
      vendorId: { type: String },
      storeId: { type: String },
      sellerName: { type: String },
    },
  },
  { timestamps: true },
);

customerFavoriteSchema.index({ customerId: 1, type: 1, targetId: 1 }, { unique: true });

export const CustomerFavorite = model<ICustomerFavorite>('CustomerFavorite', customerFavoriteSchema);
