import { Schema, model, Document, Types } from 'mongoose';
import { BUSINESS_TYPES, ORDER_STATUS_VALUES } from '../constants/orderStatus';
import { PAYMENT_METHODS, PAYMENT_STATUS } from '../constants/paymentStatus';

export interface IOrderAddressSnapshot {
  address: string;
  landmark?: string;
  pincode: string;
  latitude: number;
  longitude: number;
}

export interface IOrder extends Document {
  _id: Types.ObjectId;
  orderNumber: string;
  locationId: Types.ObjectId;
  businessType: string;
  customerId: Types.ObjectId;
  vendorId?: Types.ObjectId;
  storeId?: Types.ObjectId;
  subtotal: number;
  discount: number;
  couponDiscount: number;
  couponCode?: string;
  tax: number;
  deliveryFee: number;
  packagingFee: number;
  platformFee: number;
  total: number;
  paymentId?: Types.ObjectId;
  paymentMethod: string;
  paymentStatus: string;
  deliveryPartnerId?: Types.ObjectId;
  deliveryId?: Types.ObjectId;
  deliveryAddress: IOrderAddressSnapshot;
  status: string;
  cancelReason?: string;
  cancelledBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const addressSnapshotSchema = new Schema<IOrderAddressSnapshot>(
  {
    address: { type: String, required: true },
    landmark: { type: String },
    pincode: { type: String, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
  },
  { _id: false },
);

const orderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true, unique: true },
    locationId: { type: Schema.Types.ObjectId, ref: 'Location', required: true, index: true },
    businessType: { type: String, enum: Object.values(BUSINESS_TYPES), required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: 'Vendor', index: true },
    storeId: { type: Schema.Types.ObjectId, ref: 'Store', index: true },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0 },
    couponDiscount: { type: Number, default: 0 },
    couponCode: { type: String },
    tax: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    packagingFee: { type: Number, default: 0 },
    platformFee: { type: Number, default: 0 },
    total: { type: Number, required: true, min: 0 },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment' },
    paymentMethod: { type: String, enum: Object.values(PAYMENT_METHODS), required: true },
    paymentStatus: { type: String, enum: Object.values(PAYMENT_STATUS), default: PAYMENT_STATUS.PENDING },
    deliveryPartnerId: { type: Schema.Types.ObjectId, ref: 'DeliveryPartner', index: true },
    deliveryId: { type: Schema.Types.ObjectId, ref: 'Delivery' },
    deliveryAddress: { type: addressSnapshotSchema, required: true },
    status: { type: String, enum: ORDER_STATUS_VALUES, required: true, index: true },
    cancelReason: { type: String },
    cancelledBy: { type: String },
  },
  { timestamps: true },
);

orderSchema.pre('validate', function (next) {
  if (this.businessType === BUSINESS_TYPES.FOOD) {
    if (!this.vendorId) return next(new Error('vendorId is required for FOOD orders'));
    if (this.storeId) return next(new Error('storeId must be null for FOOD orders'));
  }
  if (this.businessType === BUSINESS_TYPES.INSTAMART) {
    if (!this.storeId) return next(new Error('storeId is required for INSTAMART orders'));
    if (this.vendorId) return next(new Error('vendorId must be null for INSTAMART orders'));
  }
  next();
});

orderSchema.index({ locationId: 1, businessType: 1, status: 1, createdAt: -1 });
orderSchema.index({ customerId: 1, createdAt: -1 });

export const Order = model<IOrder>('Order', orderSchema);
