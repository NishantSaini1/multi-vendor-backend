import { DeliveryIssue } from '../models/DeliveryIssue';
import { Delivery, IDelivery } from '../models/Delivery';
import { Order, IOrder } from '../models/Order';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';
import { DELIVERY_ISSUE_STATUS } from '../constants/deliveryStatus';

async function loadDeliveryAndOrder(deliveryId: string): Promise<{ delivery: IDelivery; order: IOrder }> {
  const delivery = await Delivery.findById(deliveryId);
  if (!delivery) throw ApiError.notFound('Delivery not found', 'DELIVERY_NOT_FOUND');
  const order = await Order.findById(delivery.orderId);
  if (!order) throw ApiError.notFound('Order not found', 'ORDER_NOT_FOUND');
  return { delivery, order };
}

// Only the three parties who actually experience a delivery can raise an
// issue against it — an admin acting "on behalf of" someone isn't a
// supported flow here (they'd be the one resolving the issue, not raising
// it), so this deliberately has no ADMIN branch.
function assertCanRaiseIssue(delivery: IDelivery, order: IOrder, user: JwtPayload): void {
  if (user.userType === 'CUSTOMER' && order.customerId.toString() === user.userId) return;
  if (user.userType === 'VENDOR' && order.vendorId?.toString() === user.userId) return;
  if (user.userType === 'DELIVERY_PARTNER' && delivery.deliveryPartnerId.toString() === user.userId) return;
  throw ApiError.forbidden('You do not have access to this delivery', 'DELIVERY_FORBIDDEN');
}

export async function createDeliveryIssue(
  data: { deliveryId: string; type: string; description?: string; images: string[] },
  user: JwtPayload,
) {
  const { delivery, order } = await loadDeliveryAndOrder(data.deliveryId);
  assertCanRaiseIssue(delivery, order, user);

  return DeliveryIssue.create({
    deliveryId: delivery.id,
    orderId: order.id,
    raisedBy: user.userId,
    raisedByType: user.userType,
    type: data.type,
    description: data.description,
    images: data.images,
    status: DELIVERY_ISSUE_STATUS.OPEN,
  });
}

// Any of the three parties on the delivery can see issues raised on it
// (not just the ones they personally raised — a delivery partner needs
// visibility into a complaint the customer filed about their delivery, and
// vice versa), plus an admin with DELIVERY_ISSUE_VIEW, location-scoped via
// the owning Order (DeliveryIssue has no locationId of its own).
export async function deliveryIssueListFilter(user: JwtPayload): Promise<Record<string, unknown>> {
  if (user.userType === 'ADMIN') {
    const orderFilter = locationScopeFilter(user);
    if (Object.keys(orderFilter).length === 0) return {};
    const orderIds = await Order.find(orderFilter).distinct('_id');
    return { orderId: { $in: orderIds } };
  }
  if (user.userType === 'CUSTOMER') {
    const orderIds = await Order.find({ customerId: user.userId }).distinct('_id');
    return { orderId: { $in: orderIds } };
  }
  if (user.userType === 'VENDOR') {
    const orderIds = await Order.find({ vendorId: user.userId }).distinct('_id');
    return { orderId: { $in: orderIds } };
  }
  // DELIVERY_PARTNER
  const deliveryIds = await Delivery.find({ deliveryPartnerId: user.userId }).distinct('_id');
  return { deliveryId: { $in: deliveryIds } };
}

export async function listDeliveryIssues(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    DeliveryIssue.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    DeliveryIssue.countDocuments(filter),
  ]);
  return { items, total };
}

async function findIssueOrThrow(id: string) {
  const issue = await DeliveryIssue.findById(id);
  if (!issue) throw ApiError.notFound('Delivery issue not found', 'DELIVERY_ISSUE_NOT_FOUND');
  return issue;
}

function assertIssueAccess(delivery: IDelivery, order: IOrder, user: JwtPayload): void {
  if (user.userType === 'ADMIN') {
    assertLocationAccess(user, order.locationId.toString());
    return;
  }
  if (user.userType === 'CUSTOMER' && order.customerId.toString() === user.userId) return;
  if (user.userType === 'VENDOR' && order.vendorId?.toString() === user.userId) return;
  if (user.userType === 'DELIVERY_PARTNER' && delivery.deliveryPartnerId.toString() === user.userId) return;
  throw ApiError.forbidden('You do not have access to this delivery issue', 'DELIVERY_ISSUE_FORBIDDEN');
}

export async function getDeliveryIssueById(id: string, user: JwtPayload) {
  const issue = await findIssueOrThrow(id);
  const { delivery, order } = await loadDeliveryAndOrder(issue.deliveryId.toString());
  assertIssueAccess(delivery, order, user);
  return issue;
}

export async function updateDeliveryIssueStatus(
  id: string,
  data: { status: string; resolutionNote?: string },
  user: JwtPayload,
) {
  const issue = await findIssueOrThrow(id);
  const order = await Order.findById(issue.orderId);
  if (order) assertLocationAccess(user, order.locationId.toString());

  issue.status = data.status;
  if (data.resolutionNote) issue.resolutionNote = data.resolutionNote;
  if (data.status === DELIVERY_ISSUE_STATUS.RESOLVED) issue.resolvedAt = new Date();
  await issue.save();
  return issue;
}
