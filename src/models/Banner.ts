import { Schema, model, Document, Types } from 'mongoose';
import { BANNER_PLACEMENTS, GENERIC_STATUS } from '../constants/enums';
import { BUSINESS_TYPES } from '../constants/orderStatus';

export interface IBanner extends Document {
  _id: Types.ObjectId;
  title: string;
  image: string;
  placement: string;
  // Orthogonal to `placement` (which is GLOBAL/LOCATION/FOOD/INSTAMART/VENDOR/
  // STORE — a targeting *scope*): businessType optionally narrows a
  // GLOBAL/LOCATION banner to just the Food or just the Instamart tab,
  // mirroring Offer's businessType field. Omitted means "shows on both".
  businessType?: string;
  locationId?: Types.ObjectId;
  vendorId?: Types.ObjectId;
  storeId?: Types.ObjectId;
  linkType?: string;
  linkValue?: string;
  sortOrder: number;
  startDate?: Date;
  endDate?: Date;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

const bannerSchema = new Schema<IBanner>(
  {
    title: { type: String, required: true },
    image: { type: String, required: true },
    placement: { type: String, enum: Object.values(BANNER_PLACEMENTS), required: true, index: true },
    businessType: { type: String, enum: Object.values(BUSINESS_TYPES) },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location' },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    storeId: { type: Schema.Types.ObjectId, ref: 'Store' },
    linkType: { type: String },
    linkValue: { type: String },
    sortOrder: { type: Number, default: 0 },
    startDate: { type: Date },
    endDate: { type: Date },
    status: { type: String, enum: Object.values(GENERIC_STATUS), default: GENERIC_STATUS.ACTIVE },
  },
  { timestamps: true },
);

export const Banner = model<IBanner>('Banner', bannerSchema);
