import { Schema, model, Document, Types } from 'mongoose';
import { BUSINESS_TYPES, ORDER_STATUS_VALUES } from '../constants/orderStatus';
import { PAYMENT_METHODS, PAYMENT_STATUS } from '../constants/paymentStatus';
import { DISCOUNT_TYPES, PRICING_MODELS } from '../constants/enums';

export interface IOrderAddressSnapshot {
  address: string;
  landmark?: string;
  pincode: string;
  latitude: number;
  longitude: number;
  contactName?: string;
  contactPhone?: string;
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
  // Commission snapshot — resolved via commission.service.resolveCommission
  // and captured at order-creation time (see order.service.ts's createOrder),
  // not re-resolved live at settlement time. All four stay unset when no
  // commission rule applies (the vendor/store keeps 100%, same as
  // resolveCommission returning null).
  commissionType?: string;
  commissionRate?: number;
  commissionBaseAmount?: number;
  commissionAmount?: number;
  // Pricing-model snapshot, captured at order creation alongside the
  // commission snapshot above (a later change to the vendor's/store's model
  // never changes an already-placed order). All unset on orders placed before
  // pricing models existed, which are treated as COMMISSION.
  //   customerPrice  — what the customer pays for the items (subtotal - discount)
  //   markupAmount   — MARKUP model only: platform's cut baked into customerPrice
  //   vendorSettlementAmount — what the vendor/store is owed for the items
  //   platformProfit — commissionAmount (COMMISSION) or markupAmount (MARKUP)
  pricingModel?: string;
  // Legacy: markup used to be configured per seller; it is now per product (see
  // OrderItem.markupPercent). Only present on orders placed under the old model.
  markupType?: string;
  markupValue?: number;
  customerPrice?: number;
  vendorBaseAmount?: number;
  markupAmount?: number;
  vendorSettlementAmount?: number;
  platformProfit?: number;
  // Full financial breakdown, each component kept apart (they settle and
  // account differently): platformRevenue is the commission + markup taken on
  // the items; deliveryRevenue is the delivery fee the customer paid, with
  // deliveryPartnerPayout the share that goes to the rider; paymentGatewayFee
  // and couponExpense are costs the platform bears; platformExpenses is those
  // costs plus the rider payout; platformNetProfit is revenue minus expenses.
  // Tax (order.tax) is collected on the government's behalf and is in neither.
  platformRevenue?: number;
  deliveryRevenue?: number;
  deliveryPartnerPayout?: number;
  paymentGatewayFee?: number;
  couponExpense?: number;
  platformExpenses?: number;
  platformNetProfit?: number;
  // Share of the order's payment refunded so far (0–1). The profit reports
  // reverse that share of the order's markup profit / commission revenue.
  refundRatio?: number;
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
    contactName: { type: String },
    contactPhone: { type: String },
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
    commissionType: { type: String, enum: Object.values(DISCOUNT_TYPES) },
    commissionRate: { type: Number, min: 0 },
    commissionBaseAmount: { type: Number, min: 0 },
    commissionAmount: { type: Number, min: 0 },
    pricingModel: { type: String, enum: Object.values(PRICING_MODELS) },
    markupType: { type: String, enum: Object.values(DISCOUNT_TYPES) },
    markupValue: { type: Number, min: 0 },
    customerPrice: { type: Number, min: 0 },
    vendorBaseAmount: { type: Number, min: 0 },
    markupAmount: { type: Number, min: 0 },
    vendorSettlementAmount: { type: Number },
    platformProfit: { type: Number },
    platformRevenue: { type: Number },
    deliveryRevenue: { type: Number, min: 0 },
    deliveryPartnerPayout: { type: Number, min: 0 },
    paymentGatewayFee: { type: Number, min: 0 },
    couponExpense: { type: Number, min: 0 },
    platformExpenses: { type: Number },
    platformNetProfit: { type: Number },
    refundRatio: { type: Number, min: 0, max: 1 },
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
