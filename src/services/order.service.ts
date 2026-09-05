import mongoose from 'mongoose';
import { Order, IOrder } from '../models/Order';
import { OrderItem, IOrderItemAddon } from '../models/OrderItem';
import { OrderStatusHistory } from '../models/OrderStatusHistory';
import { Customer } from '../models/Customer';
import { CustomerAddress } from '../models/CustomerAddress';
import { Location } from '../models/Location';
import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { FoodProduct } from '../models/FoodProduct';
import { FoodVariant } from '../models/FoodVariant';
import { FoodAddon } from '../models/FoodAddon';
import { InstamartProduct } from '../models/InstamartProduct';
import { Inventory } from '../models/Inventory';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { Payment } from '../models/Payment';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';
import { generateOrderNumber } from '../utils/orderNumber';
import { checkServiceability } from './serviceability.service';
import { BUSINESS_TYPES } from '../constants/orderStatus';
import { FOOD_ORDER_TRANSITIONS, INSTAMART_ORDER_TRANSITIONS } from '../constants/orderStatus';
import { PAYMENT_METHODS, PAYMENT_STATUS, WALLET_TRANSACTION_TYPES } from '../constants/paymentStatus';
import { VENDOR_STATUS, APPROVAL_STATUS, STORE_STATUS, GENERIC_STATUS } from '../constants/enums';
import { INVENTORY_TRANSACTION_TYPES } from '../constants/enums';
import * as walletService from './wallet.service';
import * as refundService from './refund.service';
import * as couponService from './coupon.service';
import * as notificationService from './notification.service';
import { notifyOrderStatusChange } from '../utils/orderNotifications';
import { NOTIFICATION_TYPES } from '../constants/enums';

interface CreateOrderItemInput {
  productId: string;
  variantId?: string;
  quantity: number;
  addons: { addonId: string; quantity: number }[];
}

interface CreateOrderInput {
  businessType: 'FOOD' | 'INSTAMART';
  vendorId?: string;
  storeId?: string;
  addressId: string;
  items: CreateOrderItemInput[];
  paymentMethod: string;
  couponCode?: string;
}

interface PreparedOrderItem {
  productId: string;
  variantId?: string;
  name: string;
  price: number;
  quantity: number;
  addons: IOrderItemAddon[];
  itemTotal: number;
  lineSubtotal: number;
  lineDiscount: number;
  lineTax: number;
}

function assertOrderAccess(user: JwtPayload, order: IOrder): void {
  if (user.userType === 'CUSTOMER') {
    if (order.customerId.toString() !== user.userId) throw ApiError.forbidden('You do not have access to this order', 'ORDER_FORBIDDEN');
    return;
  }
  if (user.userType === 'VENDOR') {
    if (order.vendorId?.toString() !== user.userId) throw ApiError.forbidden('You do not have access to this order', 'ORDER_FORBIDDEN');
    return;
  }
  if (user.userType === 'DELIVERY_PARTNER') {
    if (order.deliveryPartnerId?.toString() !== user.userId) throw ApiError.forbidden('You do not have access to this order', 'ORDER_FORBIDDEN');
    return;
  }
  assertLocationAccess(user, order.locationId.toString());
}

export function orderListFilter(user: JwtPayload): Record<string, unknown> {
  if (user.userType === 'CUSTOMER') return { customerId: user.userId };
  if (user.userType === 'VENDOR') return { vendorId: user.userId };
  if (user.userType === 'DELIVERY_PARTNER') return { deliveryPartnerId: user.userId };
  return locationScopeFilter(user);
}

// Product price line math: `discount` and `tax` on Food/Instamart products are
// treated as percentages — discount applies to the pre-tax line (incl. addons
// for Food), tax applies after the discount. This is a documented judgment
// call (the spec doesn't pin down the exact formula) — see README.
function computeLine(unitPrice: number, quantity: number, discountPct: number, taxPct: number, addonsUnitTotal = 0) {
  const lineSubtotal = unitPrice * quantity;
  const addonsTotal = addonsUnitTotal * quantity;
  const lineDiscount = lineSubtotal * (discountPct / 100);
  const taxableBase = lineSubtotal - lineDiscount + addonsTotal;
  const lineTax = taxableBase * (taxPct / 100);
  const itemTotal = taxableBase + lineTax;
  return { lineSubtotal: lineSubtotal + addonsTotal, lineDiscount, lineTax, itemTotal };
}

async function prepareFoodItems(vendorId: string, items: CreateOrderItemInput[]): Promise<PreparedOrderItem[]> {
  const prepared: PreparedOrderItem[] = [];

  for (const input of items) {
    const product = await FoodProduct.findById(input.productId);
    if (!product) throw ApiError.notFound(`Product ${input.productId} not found`, 'PRODUCT_NOT_FOUND');
    if (product.vendorId.toString() !== vendorId) {
      throw ApiError.badRequest('All products in an order must belong to the same vendor', 'PRODUCT_VENDOR_MISMATCH');
    }
    if (product.status !== GENERIC_STATUS.ACTIVE || !product.isAvailable) {
      throw ApiError.unprocessable(`${product.name} is not currently available`, 'PRODUCT_NOT_AVAILABLE');
    }

    let unitPrice = product.price;
    if (input.variantId) {
      const variant = await FoodVariant.findById(input.variantId);
      if (!variant || variant.productId.toString() !== product.id) {
        throw ApiError.badRequest('Invalid variant for this product', 'INVALID_VARIANT');
      }
      unitPrice = variant.price;
    }

    const addonSnapshots: IOrderItemAddon[] = [];
    let addonsUnitTotal = 0;
    for (const addonInput of input.addons) {
      const addon = await FoodAddon.findById(addonInput.addonId);
      if (!addon || addon.vendorId.toString() !== vendorId) {
        throw ApiError.badRequest('Invalid addon for this vendor', 'INVALID_ADDON');
      }
      addonsUnitTotal += addon.price * addonInput.quantity;
      addonSnapshots.push({
        addonId: addon._id,
        name: addon.name,
        price: addon.price,
        quantity: addonInput.quantity,
      });
    }

    const { lineSubtotal, lineDiscount, lineTax, itemTotal } = computeLine(
      unitPrice,
      input.quantity,
      product.discount,
      product.tax,
      addonsUnitTotal,
    );

    prepared.push({
      productId: product.id,
      variantId: input.variantId,
      name: product.name,
      price: unitPrice,
      quantity: input.quantity,
      addons: addonSnapshots,
      itemTotal,
      lineSubtotal,
      lineDiscount,
      lineTax,
    });
  }

  return prepared;
}

async function prepareInstamartItems(storeId: string, items: CreateOrderItemInput[]): Promise<PreparedOrderItem[]> {
  const prepared: PreparedOrderItem[] = [];

  for (const input of items) {
    if (input.variantId || input.addons.length > 0) {
      throw ApiError.badRequest('Variants and addons are not supported for Instamart items', 'INSTAMART_ITEM_UNSUPPORTED');
    }

    const product = await InstamartProduct.findById(input.productId);
    if (!product) throw ApiError.notFound(`Product ${input.productId} not found`, 'PRODUCT_NOT_FOUND');
    if (product.storeId.toString() !== storeId) {
      throw ApiError.badRequest('All products in an order must belong to the same store', 'PRODUCT_STORE_MISMATCH');
    }
    if (product.status !== GENERIC_STATUS.ACTIVE) {
      throw ApiError.unprocessable(`${product.name} is not currently available`, 'PRODUCT_NOT_AVAILABLE');
    }

    // Authoritative stock check happens again inside the transaction below;
    // this pre-check just fails fast for the common case.
    const inventory = await Inventory.findOne({ storeId, productId: product.id });
    if (!inventory || inventory.currentStock - inventory.reservedStock < input.quantity) {
      throw ApiError.unprocessable(`${product.name} does not have enough stock`, 'INSUFFICIENT_STOCK');
    }

    const { lineSubtotal, lineDiscount, lineTax, itemTotal } = computeLine(
      product.sellingPrice,
      input.quantity,
      product.discount,
      product.tax,
    );

    prepared.push({
      productId: product.id,
      name: product.name,
      price: product.sellingPrice,
      quantity: input.quantity,
      addons: [],
      itemTotal,
      lineSubtotal,
      lineDiscount,
      lineTax,
    });
  }

  return prepared;
}

export async function createOrder(customerId: string, data: CreateOrderInput) {
  const customer = await Customer.findById(customerId);
  if (!customer) throw ApiError.notFound('Customer not found', 'CUSTOMER_NOT_FOUND');

  const address = await CustomerAddress.findOne({ _id: data.addressId, customerId });
  if (!address) throw ApiError.notFound('Address not found', 'ADDRESS_NOT_FOUND');

  const location = await Location.findById(address.locationId);
  if (!location || location.status !== GENERIC_STATUS.ACTIVE) {
    throw ApiError.unprocessable('This location is not currently serviceable', 'LOCATION_NOT_ACTIVE');
  }

  const serviceability = await checkServiceability(address.latitude, address.longitude, data.businessType);
  if (!serviceability.serviceable) {
    throw ApiError.unprocessable('This address is not currently serviceable', serviceability.reason ?? 'NOT_SERVICEABLE');
  }
  const zone = serviceability.deliveryZone as { deliveryFee: number; freeDeliveryAbove: number; estimatedDeliveryTime: number };

  let vendorId: string | undefined;
  let storeId: string | undefined;

  if (data.businessType === BUSINESS_TYPES.FOOD) {
    const vendor = await Vendor.findById(data.vendorId);
    if (!vendor) throw ApiError.notFound('Vendor not found', 'VENDOR_NOT_FOUND');
    if (vendor.status !== VENDOR_STATUS.ACTIVE || vendor.approvalStatus !== APPROVAL_STATUS.APPROVED) {
      throw ApiError.unprocessable('This vendor is not currently active', 'VENDOR_NOT_ACTIVE');
    }
    if (!vendor.isOpen) throw ApiError.unprocessable('This vendor is currently closed', 'VENDOR_CLOSED');
    if (vendor.locationId.toString() !== location.id) {
      throw ApiError.badRequest('Vendor does not belong to the delivery address location', 'VENDOR_LOCATION_MISMATCH');
    }
    vendorId = vendor.id;
  } else {
    const store = await Store.findById(data.storeId);
    if (!store) throw ApiError.notFound('Store not found', 'STORE_NOT_FOUND');
    if (store.status !== STORE_STATUS.ACTIVE) throw ApiError.unprocessable('This store is not currently active', 'STORE_NOT_ACTIVE');
    if (store.locationId.toString() !== location.id) {
      throw ApiError.badRequest('Store does not belong to the delivery address location', 'STORE_LOCATION_MISMATCH');
    }
    storeId = store.id;
  }

  const preparedItems =
    data.businessType === BUSINESS_TYPES.FOOD
      ? await prepareFoodItems(vendorId!, data.items)
      : await prepareInstamartItems(storeId!, data.items);

  const subtotal = preparedItems.reduce((sum, i) => sum + i.lineSubtotal, 0);
  const discount = preparedItems.reduce((sum, i) => sum + i.lineDiscount, 0);
  const tax = preparedItems.reduce((sum, i) => sum + i.lineTax, 0);
  const deliveryFee = subtotal >= zone.freeDeliveryAbove ? 0 : zone.deliveryFee;
  const packagingFee = 0;
  const platformFee = 0;

  const session = await mongoose.startSession();
  try {
    let createdOrder: InstanceType<typeof Order> | undefined;

    await session.withTransaction(async () => {
      // Coupon validation/application happens first, inside the same
      // transaction as everything else — the usedCount increment it does
      // must be atomic with the order that actually consumed it (a failed
      // order creation must not burn a use).
      let couponCode: string | undefined;
      let couponDiscount = 0;
      if (data.couponCode) {
        const result = await couponService.applyCoupon(
          data.couponCode,
          { customerId, locationId: location.id, businessType: data.businessType, vendorId, storeId, subtotal },
          session,
        );
        couponCode = result.coupon.code;
        couponDiscount = result.discount;
      }
      const total = subtotal - discount + tax + deliveryFee + packagingFee + platformFee - couponDiscount;

      if (data.businessType === BUSINESS_TYPES.INSTAMART) {
        for (const item of preparedItems) {
          const inventory = await Inventory.findOne({ storeId, productId: item.productId }).session(session);
          if (!inventory || inventory.currentStock - inventory.reservedStock < item.quantity) {
            throw ApiError.unprocessable(`${item.name} does not have enough stock`, 'INSUFFICIENT_STOCK');
          }
          const stockBefore = inventory.currentStock;
          inventory.reservedStock += item.quantity;
          await inventory.save({ session });
          await InventoryTransaction.create(
            [
              {
                inventoryId: inventory.id,
                storeId,
                productId: item.productId,
                type: INVENTORY_TRANSACTION_TYPES.RESERVATION,
                quantity: item.quantity,
                stockBefore,
                stockAfter: inventory.currentStock,
                performedBy: customerId,
                referenceType: 'ORDER',
                note: 'Reserved on order creation',
              },
            ],
            { session },
          );
        }
      }

      const [order] = await Order.create(
        [
          {
            orderNumber: generateOrderNumber(),
            locationId: location.id,
            businessType: data.businessType,
            customerId,
            vendorId,
            storeId,
            subtotal,
            discount,
            couponCode,
            couponDiscount,
            tax,
            deliveryFee,
            packagingFee,
            platformFee,
            total,
            paymentMethod: data.paymentMethod,
            paymentStatus: PAYMENT_STATUS.PENDING,
            deliveryAddress: {
              address: address.address,
              landmark: address.landmark,
              pincode: address.pincode,
              latitude: address.latitude,
              longitude: address.longitude,
            },
            status: 'PENDING',
          },
        ],
        { session },
      );

      // WALLET is the one payment method that's settled synchronously at
      // order-creation time — there's no external checkout step to wait on,
      // so debit it here (inside the same transaction as the reservation
      // above) and mark the order paid immediately. RAZORPAY stays PENDING
      // until checkout completes (see payment.service); COD stays PENDING
      // until collected on delivery.
      if (data.paymentMethod === PAYMENT_METHODS.WALLET) {
        await walletService.debitWallet(customerId, total, WALLET_TRANSACTION_TYPES.DEBIT, order.id, `Payment for order ${order.orderNumber}`, session);

        const [payment] = await Payment.create(
          [
            {
              orderId: order.id,
              customerId,
              amount: total,
              method: PAYMENT_METHODS.WALLET,
              status: PAYMENT_STATUS.PAID,
              paidAt: new Date(),
            },
          ],
          { session },
        );

        order.paymentId = payment.id;
        order.paymentStatus = PAYMENT_STATUS.PAID;
        await order.save({ session });
      }

      await OrderItem.insertMany(
        preparedItems.map((item) => ({
          orderId: order.id,
          productId: item.productId,
          variantId: item.variantId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          addons: item.addons,
          itemTotal: item.itemTotal,
        })),
        { session },
      );

      await OrderStatusHistory.create(
        [
          {
            orderId: order.id,
            newStatus: 'PENDING',
            changedBy: customerId,
            changedByType: 'CUSTOMER',
          },
        ],
        { session },
      );

      createdOrder = order;
    });

    // Fire-and-forget, after the transaction has committed — a notification
    // failure must never look like order creation itself failed.
    await notificationService.notify(
      customerId,
      'CUSTOMER',
      NOTIFICATION_TYPES.ORDER_CREATED,
      'Order placed',
      `Your order ${createdOrder!.orderNumber} has been placed.`,
      { orderId: createdOrder!.id },
    );
    if (createdOrder!.paymentStatus === PAYMENT_STATUS.PAID) {
      await notificationService.notify(
        customerId,
        'CUSTOMER',
        NOTIFICATION_TYPES.PAYMENT_SUCCESS,
        'Payment successful',
        `Your payment of ${createdOrder!.total} for order ${createdOrder!.orderNumber} was successful.`,
        { orderId: createdOrder!.id },
      );
    }

    return createdOrder!;
  } finally {
    await session.endSession();
  }
}

// Order only stores customerId — the vendor/admin apps need a display name
// and callable phone number (e.g. the "Contact Customer" action), so this
// attaches a { _id, name, phone } snapshot from Customer onto each plain
// order object returned to the caller.
async function withCustomer(order: IOrder): Promise<Record<string, unknown>> {
  const plain = order.toObject();
  const customer = await Customer.findById(order.customerId).select('name phone');
  if (customer) plain.customer = { _id: customer._id, name: customer.name, phone: customer.phone };
  return plain;
}

async function withCustomers(orders: IOrder[]): Promise<Record<string, unknown>[]> {
  const customerIds = [...new Set(orders.map((o) => o.customerId.toString()))];
  const customers = await Customer.find({ _id: { $in: customerIds } }).select('name phone');
  const customerById = new Map(customers.map((c) => [c._id.toString(), c]));
  return orders.map((order) => {
    const plain = order.toObject();
    const customer = customerById.get(order.customerId.toString());
    if (customer) plain.customer = { _id: customer._id, name: customer.name, phone: customer.phone };
    return plain;
  });
}

export async function listOrders(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Order.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Order.countDocuments(filter),
  ]);
  return { items: await withCustomers(items), total };
}

async function findOrderOrThrow(id: string) {
  const order = await Order.findById(id);
  if (!order) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');
  return order;
}

export async function getOrderById(id: string, user: JwtPayload) {
  const order = await findOrderOrThrow(id);
  assertOrderAccess(user, order);
  return withCustomer(order);
}

export async function getOrderItems(id: string, user: JwtPayload) {
  const order = await findOrderOrThrow(id);
  assertOrderAccess(user, order);
  return OrderItem.find({ orderId: id });
}

export async function getOrderTimeline(id: string, user: JwtPayload) {
  const order = await findOrderOrThrow(id);
  assertOrderAccess(user, order);
  return OrderStatusHistory.find({ orderId: id }).sort({ createdAt: 1 });
}

export async function updateOrder(id: string, data: { deliveryAddress?: Record<string, unknown> }, user: JwtPayload) {
  const order = await findOrderOrThrow(id);
  assertLocationAccess(user, order.locationId.toString());

  if (data.deliveryAddress) {
    order.deliveryAddress = { ...order.deliveryAddress, ...data.deliveryAddress };
  }
  await order.save();
  return withCustomer(order);
}

function transitionMapFor(businessType: string): Record<string, string[]> {
  return businessType === BUSINESS_TYPES.FOOD ? FOOD_ORDER_TRANSITIONS : INSTAMART_ORDER_TRANSITIONS;
}

export async function updateOrderStatus(id: string, newStatus: string, user: JwtPayload) {
  const order = await findOrderOrThrow(id);
  assertOrderAccess(user, order);

  const allowedNext = transitionMapFor(order.businessType)[order.status] ?? [];
  if (!allowedNext.includes(newStatus)) {
    throw ApiError.badRequest(`Cannot transition order from ${order.status} to ${newStatus}`, 'INVALID_STATUS_TRANSITION');
  }

  if (newStatus === 'CANCELLED') {
    return cancelOrder(id, 'Cancelled via status update', user);
  }

  const oldStatus = order.status;
  order.status = newStatus;
  await order.save();

  await OrderStatusHistory.create({
    orderId: order.id,
    oldStatus,
    newStatus,
    changedBy: user.userId,
    changedByType: user.userType,
  });

  await notifyOrderStatusChange(order, newStatus);

  return withCustomer(order);
}

const CANCELLABLE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'PREPARING', 'PACKING']);

export async function cancelOrder(id: string, reason: string, user: JwtPayload) {
  const order = await findOrderOrThrow(id);
  assertOrderAccess(user, order);

  if (!CANCELLABLE_STATUSES.has(order.status)) {
    throw ApiError.badRequest(`Order cannot be cancelled from status ${order.status}`, 'ORDER_NOT_CANCELLABLE');
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (order.businessType === BUSINESS_TYPES.INSTAMART) {
        const items = await OrderItem.find({ orderId: id }).session(session);
        for (const item of items) {
          const inventory = await Inventory.findOne({ storeId: order.storeId, productId: item.productId }).session(session);
          if (!inventory) continue;
          const stockBefore = inventory.currentStock;
          inventory.reservedStock = Math.max(0, inventory.reservedStock - item.quantity);
          await inventory.save({ session });
          await InventoryTransaction.create(
            [
              {
                inventoryId: inventory.id,
                storeId: order.storeId,
                productId: item.productId,
                type: INVENTORY_TRANSACTION_TYPES.RELEASE,
                quantity: item.quantity,
                stockBefore,
                stockAfter: inventory.currentStock,
                performedBy: user.userId,
                referenceType: 'ORDER',
                note: 'Released on order cancellation',
              },
            ],
            { session },
          );
        }
      }

      const oldStatus = order.status;
      order.status = 'CANCELLED';
      order.cancelReason = reason;
      order.cancelledBy = user.userType;
      await order.save({ session });

      await OrderStatusHistory.create(
        [
          {
            orderId: order.id,
            oldStatus,
            newStatus: 'CANCELLED',
            changedBy: user.userId,
            changedByType: user.userType,
            reason,
          },
        ],
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  // Best-effort, outside the DB transaction that already committed above —
  // a gateway refund is an external call and must never be attempted inside
  // a mongoose session (it can't be rolled back if the transaction later
  // failed, and holding the transaction open across a network call to
  // Razorpay would be its own problem). See refund.service for the
  // fail-open behavior (order stays cancelled either way).
  if (order.paymentStatus === PAYMENT_STATUS.PAID) {
    await refundService.autoRefundForCancelledOrder(order, `Order cancelled: ${reason}`);
  }

  await notifyOrderStatusChange(order, 'CANCELLED');

  return withCustomer(order);
}
