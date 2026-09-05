import { Order } from '../models/Order';
import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { DeliveryPartner } from '../models/DeliveryPartner';
import { DeliveryIssue } from '../models/DeliveryIssue';
import { JwtPayload } from '../utils/jwt';
import { locationScopeFilter } from '../middleware/rbac.middleware';
import { APPROVAL_STATUS } from '../constants/enums';
import { DELIVERY_ISSUE_STATUS } from '../constants/deliveryStatus';
import { deliveryIssueListFilter } from './deliveryIssue.service';

function countsByStatus(rows: { _id: string; count: number }[]): Record<string, number> {
  return rows.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {} as Record<string, number>);
}

export async function getOverview(user: JwtPayload, from: Date, to: Date) {
  const locationFilter = locationScopeFilter(user);
  const orderMatch = { ...locationFilter, createdAt: { $gte: from, $lte: to } };

  const [orderTotals, ordersByStatusRaw, vendorsByStatusRaw, storesByStatusRaw, partnersByStatusRaw, pendingVendorApprovals, issueFilter] =
    await Promise.all([
      Order.aggregate([{ $match: orderMatch }, { $group: { _id: null, totalOrders: { $sum: 1 }, totalRevenue: { $sum: '$total' } } }]),
      Order.aggregate([{ $match: orderMatch }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Vendor.aggregate([{ $match: locationFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Store.aggregate([{ $match: locationFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      DeliveryPartner.aggregate([{ $match: locationFilter }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
      Vendor.countDocuments({ ...locationFilter, approvalStatus: APPROVAL_STATUS.PENDING }),
      deliveryIssueListFilter(user),
    ]);

  const openDeliveryIssues = await DeliveryIssue.countDocuments({
    ...issueFilter,
    status: { $in: [DELIVERY_ISSUE_STATUS.OPEN, DELIVERY_ISSUE_STATUS.IN_PROGRESS] },
  });

  return {
    period: { from, to },
    orders: {
      totalOrders: orderTotals[0]?.totalOrders ?? 0,
      totalRevenue: orderTotals[0]?.totalRevenue ?? 0,
      byStatus: countsByStatus(ordersByStatusRaw),
    },
    vendors: { total: vendorsByStatusRaw.reduce((sum, r) => sum + r.count, 0), byStatus: countsByStatus(vendorsByStatusRaw), pendingApprovals: pendingVendorApprovals },
    stores: { total: storesByStatusRaw.reduce((sum, r) => sum + r.count, 0), byStatus: countsByStatus(storesByStatusRaw) },
    deliveryPartners: { total: partnersByStatusRaw.reduce((sum, r) => sum + r.count, 0), byStatus: countsByStatus(partnersByStatusRaw) },
    openDeliveryIssues,
  };
}

export async function getOrdersTrend(user: JwtPayload, days: number) {
  const locationFilter = locationScopeFilter(user);
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));

  const rows = await Order.aggregate([
    { $match: { ...locationFilter, createdAt: { $gte: from } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        orders: { $sum: 1 },
        revenue: { $sum: '$total' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((r) => ({ date: r._id, orders: r.orders, revenue: r.revenue }));
}
