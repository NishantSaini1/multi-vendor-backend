import mongoose from 'mongoose';
import { Order, IOrder } from '../models/Order';
import { OrderItem, IOrderItemModifier } from '../models/OrderItem';
import { OrderStatusHistory } from '../models/OrderStatusHistory';
import { Customer } from '../models/Customer';
import { CustomerAddress } from '../models/CustomerAddress';
import { Location } from '../models/Location';
import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { InstamartProduct } from '../models/InstamartProduct';
import { InstamartGlobalProduct } from '../models/InstamartGlobalProduct';
import { InstamartVariant } from '../models/InstamartVariant';
import { Inventory } from '../models/Inventory';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { Payment } from '../models/Payment';
import { Cart } from '../models/Cart';
import { CartItem } from '../models/CartItem';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';
import { generateOrderNumber } from '../utils/orderNumber';
import { checkServiceability } from './serviceability.service';
import { computeLine, resolveFoodLineItem } from './foodPricing.service';
import * as commissionService from './commission.service';
import { BUSINESS_TYPES } from '../constants/orderStatus';
import { FOOD_ORDER_TRANSITIONS, INSTAMART_ORDER_TRANSITIONS } from '../constants/orderStatus';
import { PAYMENT_METHODS, PAYMENT_STATUS, WALLET_TRANSACTION_TYPES } from '../constants/paymentStatus';
import { VENDOR_STATUS, APPROVAL_STATUS, STORE_STATUS, GENERIC_STATUS } from '../constants/enums';
import { INVENTORY_TRANSACTION_TYPES, DISCOUNT_TYPES, TRANSACTION_TYPE, TRANSACTION_DIRECTION } from '../constants/enums';
import * as walletService from './wallet.service';
import * as refundService from './refund.service';
import * as couponService from './coupon.service';
import * as notificationService from './notification.service';
import * as ledgerService from './ledger.service';
import { notifyOrderStatusChange } from '../utils/orderNotifications';
import { NOTIFICATION_TYPES } from '../constants/enums';

interface CreateOrderItemInput {
  // FOOD: a VendorFoodItem._id; INSTAMART: an InstamartProduct._id (see OrderItem.ts).
  productId: string;
  variantId?: string;
  quantity: number;
  // Modifier selections — FOOD only, must be empty for INSTAMART items.
  modifiers: { modifierOptionId: string; quantity: number }[];
}

interface CreateOrderInput {
  // Optional when `cartId` is given instead — see the cart-checkout branch in
  // createOrder below, which derives businessType/vendorId/items from the
  // Cart and ignores any client-supplied values for those fields.
  businessType?: 'FOOD' | 'INSTAMART';
  vendorId?: string;
  storeId?: string;
  addressId: string;
  items?: CreateOrderItemInput[];
  paymentMethod: string;
  couponCode?: string;
  // Alternative to a client-supplied items[] array — checks out from a
  // server-side Cart instead (FOOD only; see cart.service.ts).
  cartId?: string;
}

interface PreparedOrderItem {
  productId: string;
  variantId?: string;
  name: string;
  price: number;
  quantity: number;
  modifiers: IOrderItemModifier[];
  itemTotal: number;
  lineSubtotal: number;
  lineDiscount: number;
  lineTax: number;
  // FOOD only — the GLOBAL FoodProduct id this line's VendorFoodItem maps
  // onto, for Coupon.foodItemIds scoping (see couponService.applyCoupon).
  // Undefined for INSTAMART lines.
  globalFoodItemId?: string;
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
  if (user.userType === 'STORE') {
    if (order.storeId?.toString() !== user.userId) throw ApiError.forbidden('You do not have access to this order', 'ORDER_FORBIDDEN');
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
  if (user.userType === 'STORE') return { storeId: user.userId };
  if (user.userType === 'DELIVERY_PARTNER') return { deliveryPartnerId: user.userId };
  return locationScopeFilter(user);
}

async function prepareFoodItems(vendorId: string, items: CreateOrderItemInput[]): Promise<PreparedOrderItem[]> {
  const prepared: PreparedOrderItem[] = [];

  for (const input of items) {
    // Single source of truth for "resolve + validate + price one Food line"
    // — shared with cart.service.ts (see foodPricing.service.ts).
    const resolved = await resolveFoodLineItem(
      { vendorFoodItemId: input.productId, variantId: input.variantId, modifiers: input.modifiers },
      vendorId,
    );

    // The old FoodProduct carried its own discount/tax percentages; the
    // Stage 2 split (see plan) doesn't reintroduce either field on
    // VendorFoodItem, so FOOD lines no longer apply an item-level
    // discount/tax — platform-level discounting still happens via Coupon at
    // the order level. Flagged as a deliberate gap (not silently guessed)
    // pending a later stage's spec for Food item tax/discount handling.
    const { lineSubtotal, lineDiscount, lineTax, itemTotal } = computeLine(
      resolved.unitPrice,
      input.quantity,
      0,
      0,
      resolved.modifiersUnitTotal,
    );

    prepared.push({
      productId: resolved.vendorFoodItem.id,
      variantId: input.variantId,
      name: resolved.name,
      price: resolved.unitPrice,
      quantity: input.quantity,
      modifiers: resolved.modifiers,
      itemTotal,
      lineSubtotal,
      lineDiscount,
      lineTax,
      globalFoodItemId: resolved.globalItem.id,
    });
  }

  return prepared;
}

async function prepareInstamartItems(storeId: string, items: CreateOrderItemInput[]): Promise<PreparedOrderItem[]> {
  const prepared: PreparedOrderItem[] = [];

  for (const input of items) {
    if (input.modifiers.length > 0) {
      throw ApiError.badRequest('Modifiers are not supported for Instamart items', 'INSTAMART_MODIFIER_UNSUPPORTED');
    }

    const product = await InstamartProduct.findById(input.productId);
    if (!product) throw ApiError.notFound(`Product ${input.productId} not found`, 'PRODUCT_NOT_FOUND');
    if (product.storeId.toString() !== storeId) {
      throw ApiError.badRequest('All products in an order must belong to the same store', 'PRODUCT_STORE_MISMATCH');
    }
    if (product.status !== GENERIC_STATUS.ACTIVE) {
      throw ApiError.unprocessable('This product is not currently available', 'PRODUCT_NOT_AVAILABLE');
    }

    // name/tax now live on the shared Global Product this listing maps onto
    // (see instamartProduct.service.ts) — a store's own listing can be ACTIVE
    // while the catalog entry it points at is still PENDING/REJECTED/INACTIVE
    // (e.g. a store-submitted product awaiting approval), so that must be
    // re-checked here too, not just the mapping's own status above.
    const globalProduct = await InstamartGlobalProduct.findById(product.productId);
    if (!globalProduct || globalProduct.approvalStatus !== APPROVAL_STATUS.APPROVED || globalProduct.status !== GENERIC_STATUS.ACTIVE) {
      throw ApiError.unprocessable('This product is not currently available', 'PRODUCT_NOT_AVAILABLE');
    }

    // A variant (e.g. "500g" vs "1kg") is just a name + mrp/sellingPrice on
    // top of the product — it shares the product's own stock rather than
    // tracking its own (see instamartProduct.service.ts). The listing's own
    // sellingPrice/mrp (its own pack size/unit) is always a valid, orderable
    // choice in its own right, same as any named variant — variants are
    // additional pack-size options alongside it, not a replacement for it.
    let unitPrice = product.sellingPrice;
    if (input.variantId) {
      const variant = await InstamartVariant.findById(input.variantId);
      if (!variant || variant.productId.toString() !== product.id) {
        throw ApiError.badRequest('Invalid variant for this product', 'INVALID_VARIANT');
      }
      if (variant.status !== GENERIC_STATUS.ACTIVE) {
        throw ApiError.unprocessable(`${globalProduct.name} (${variant.name}) is not currently available`, 'VARIANT_NOT_AVAILABLE');
      }
      unitPrice = variant.sellingPrice;
    }

    // Authoritative stock check happens again inside the transaction below;
    // this pre-check just fails fast for the common case.
    const inventory = await Inventory.findOne({ storeId, productId: product.id });
    if (!inventory || inventory.currentStock - inventory.reservedStock < input.quantity) {
      throw ApiError.unprocessable(`${globalProduct.name} does not have enough stock`, 'INSUFFICIENT_STOCK');
    }

    const { lineSubtotal, lineDiscount, lineTax, itemTotal } = computeLine(
      unitPrice,
      input.quantity,
      product.discount,
      globalProduct.gst,
    );

    prepared.push({
      productId: product.id,
      variantId: input.variantId,
      name: globalProduct.name,
      price: unitPrice,
      quantity: input.quantity,
      modifiers: [],
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

  // Alternative to a client-supplied items[] array — checkout from a
  // server-side Cart instead (FOOD only; see cart.service.ts). The cart is
  // single-vendor by construction (enforced in cart.service.ts's addItem), so
  // businessType/vendorId/items are derived from it here and any
  // client-supplied values for those fields are ignored. The existing
  // inline-items path below is completely unchanged for callers that don't
  // pass cartId.
  let businessType = data.businessType;
  let vendorIdInput = data.vendorId;
  let items = data.items ?? [];

  if (data.cartId) {
    const cart = await Cart.findOne({ _id: data.cartId, customerId });
    if (!cart) throw ApiError.notFound('Cart not found', 'CART_NOT_FOUND');
    const cartItems = await CartItem.find({ cartId: cart.id });
    if (!cart.vendorId || cartItems.length === 0) {
      throw ApiError.badRequest('Cart is empty', 'CART_EMPTY');
    }

    businessType = BUSINESS_TYPES.FOOD;
    vendorIdInput = cart.vendorId.toString();
    items = cartItems.map((item) => ({
      productId: item.vendorFoodItemId.toString(),
      variantId: item.variantId?.toString(),
      quantity: item.quantity,
      modifiers: item.selectedModifierOptionIds.map((id) => ({ modifierOptionId: id.toString(), quantity: 1 })),
    }));
  }

  if (!businessType) throw ApiError.badRequest('businessType is required', 'BUSINESS_TYPE_REQUIRED');
  if (items.length === 0) throw ApiError.badRequest('At least one item is required', 'ITEMS_REQUIRED');

  const address = await CustomerAddress.findOne({ _id: data.addressId, customerId });
  if (!address) throw ApiError.notFound('Address not found', 'ADDRESS_NOT_FOUND');

  const location = await Location.findById(address.locationId);
  if (!location || location.status !== GENERIC_STATUS.ACTIVE) {
    throw ApiError.unprocessable('This location is not currently serviceable', 'LOCATION_NOT_ACTIVE');
  }

  const serviceability = await checkServiceability(address.latitude, address.longitude, businessType);
  if (!serviceability.serviceable) {
    throw ApiError.unprocessable('This address is not currently serviceable', serviceability.reason ?? 'NOT_SERVICEABLE');
  }
  const zone = serviceability.deliveryZone as { deliveryFee: number; freeDeliveryAbove: number; estimatedDeliveryTime: number };

  let vendorId: string | undefined;
  let storeId: string | undefined;

  if (businessType === BUSINESS_TYPES.FOOD) {
    const vendor = await Vendor.findById(vendorIdInput);
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
    businessType === BUSINESS_TYPES.FOOD ? await prepareFoodItems(vendorId!, items) : await prepareInstamartItems(storeId!, items);

  const subtotal = preparedItems.reduce((sum, i) => sum + i.lineSubtotal, 0);
  const discount = preparedItems.reduce((sum, i) => sum + i.lineDiscount, 0);
  const tax = preparedItems.reduce((sum, i) => sum + i.lineTax, 0);
  const deliveryFee = subtotal >= zone.freeDeliveryAbove ? 0 : zone.deliveryFee;
  const packagingFee = 0;
  const platformFee = 0;

  // Commission snapshot (Stage 4) — resolved and captured NOW, at order
  // creation, rather than re-resolved live at settlement time, so a later
  // change to the vendor's/store's/location's commission config never
  // retroactively changes what an already-placed order owes. Base matches
  // settlement.service.ts's "gross = subtotal - discount" for vendor/store
  // payees (delivery partners have no Commission entity of their own).
  // `resolveCommission` returning null means 100% payable, no commission —
  // all four fields stay unset.
  const commissionBaseAmount = subtotal - discount;
  const commission = await commissionService.resolveCommission({
    locationId: location.id,
    vendorId,
    storeId,
    businessType,
  });
  const commissionType = commission?.type;
  const commissionRate = commission?.value;
  const commissionAmount = commission
    ? commission.type === DISCOUNT_TYPES.PERCENTAGE
      ? commissionBaseAmount * (commission.value / 100)
      : commission.value
    : undefined;

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
        const foodItemIds = preparedItems
          .map((item) => item.globalFoodItemId)
          .filter((id): id is string => Boolean(id));
        const result = await couponService.applyCoupon(
          data.couponCode,
          { customerId, locationId: location.id, businessType, vendorId, storeId, subtotal, foodItemIds },
          session,
        );
        couponCode = result.coupon.code;
        couponDiscount = result.discount;
      }
      const total = subtotal - discount + tax + deliveryFee + packagingFee + platformFee - couponDiscount;

      if (businessType === BUSINESS_TYPES.INSTAMART) {
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
            businessType,
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
            commissionType,
            commissionRate,
            commissionBaseAmount: commission ? commissionBaseAmount : undefined,
            commissionAmount,
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

        // RAZORPAY's equivalent ledger entry is recorded from
        // payment.service.ts's markPaymentPaid (the one shared function both
        // the client-verify and webhook paths already call) — this is the
        // WALLET-only counterpart, since that path never goes through
        // markPaymentPaid.
        await ledgerService.recordTransaction(
          {
            orderId: order.id,
            vendorId,
            storeId,
            type: TRANSACTION_TYPE.ORDER_PAYMENT,
            amount: total,
            direction: TRANSACTION_DIRECTION.CREDIT,
          },
          session,
        );
      }

      await OrderItem.insertMany(
        preparedItems.map((item) => ({
          orderId: order.id,
          productId: item.productId,
          variantId: item.variantId,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          modifiers: item.modifiers,
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

      // Checked out from a Cart — clear it atomically with the order that
      // consumed it (a failed order creation must not empty the cart).
      if (data.cartId) {
        await CartItem.deleteMany({ cartId: data.cartId }).session(session);
        await Cart.updateOne({ _id: data.cartId }, { vendorId: null }).session(session);
      }

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
    // Rings the vendor app's new-order siren, even with the app closed.
    if (createdOrder!.vendorId) {
      await notificationService.notify(
        createdOrder!.vendorId.toString(),
        'VENDOR',
        NOTIFICATION_TYPES.NEW_ORDER,
        'New order received!',
        `Order ${createdOrder!.orderNumber} • ₹${createdOrder!.total} — tap to accept.`,
        { orderId: createdOrder!.id },
      );
    }
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
  const counts = await itemCountsByOrderId([order._id]);
  plain.itemCount = counts.get(order._id.toString()) ?? 0;
  return plain;
}

// OrderItem lives in its own collection (not embedded on Order), so list/
// history views need a cheap batch count to show "N items" without a
// separate round trip per order.
async function itemCountsByOrderId(orderIds: mongoose.Types.ObjectId[]): Promise<Map<string, number>> {
  if (orderIds.length === 0) return new Map();
  const counts = await OrderItem.aggregate([
    { $match: { orderId: { $in: orderIds } } },
    { $group: { _id: '$orderId', count: { $sum: 1 } } },
  ]);
  return new Map(counts.map((c) => [c._id.toString(), c.count as number]));
}

async function withCustomers(orders: IOrder[]): Promise<Record<string, unknown>[]> {
  const customerIds = [...new Set(orders.map((o) => o.customerId.toString()))];
  const [customers, itemCounts] = await Promise.all([
    Customer.find({ _id: { $in: customerIds } }).select('name phone'),
    itemCountsByOrderId(orders.map((o) => o._id)),
  ]);
  const customerById = new Map(customers.map((c) => [c._id.toString(), c]));
  return orders.map((order) => {
    const plain = order.toObject();
    const customer = customerById.get(order.customerId.toString());
    if (customer) plain.customer = { _id: customer._id, name: customer.name, phone: customer.phone };
    plain.itemCount = itemCounts.get(order._id.toString()) ?? 0;
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

  // Reachable here for a direct admin PATCH straight to DELIVERED; the
  // expected real-world path (a delivery reaching DELIVERED) instead goes
  // through delivery.service.ts's updateDeliveryStatus, which calls the same
  // shared helper — see ledger.service.ts's recordOrderCommissionLedger.
  if (newStatus === 'DELIVERED') {
    await ledgerService.recordOrderCommissionLedger(order);
  }

  await notifyOrderStatusChange(order, newStatus);

  return withCustomer(order);
}

const CANCELLABLE_STATUSES = new Set(['PENDING', 'CONFIRMED', 'PREPARING', 'PACKING']);
// Once the kitchen/store starts preparing, the customer can no longer cancel
// themselves — vendors, stores and admins still can (e.g. out of stock).
const CUSTOMER_CANCELLABLE_STATUSES = new Set(['PENDING', 'CONFIRMED']);

export async function cancelOrder(id: string, reason: string, user: JwtPayload) {
  const order = await findOrderOrThrow(id);
  assertOrderAccess(user, order);

  const allowed = user.userType === 'CUSTOMER' ? CUSTOMER_CANCELLABLE_STATUSES : CANCELLABLE_STATUSES;
  if (!allowed.has(order.status)) {
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
    // The REFUND_REASON enum is derived internally from order.cancelledBy
    // (set just above, inside the transaction) — `reason` here is just the
    // free-text detail (see refund.service.ts's autoRefundForCancelledOrder).
    await refundService.autoRefundForCancelledOrder(order, reason);
  }

  await notifyOrderStatusChange(order, 'CANCELLED');

  return withCustomer(order);
}
