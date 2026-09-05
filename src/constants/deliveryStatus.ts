export const DELIVERY_STATUS = {
  ASSIGNED: 'ASSIGNED',
  ACCEPTED: 'ACCEPTED',
  ARRIVED_AT_PICKUP: 'ARRIVED_AT_PICKUP',
  PICKED_UP: 'PICKED_UP',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;

export type DeliveryStatusType = (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS];

// Valid forward transitions for a Delivery record — the safety net for
// PATCH /deliveries/:id/status, same pattern as the Order status maps.
export const DELIVERY_TRANSITIONS: Record<string, string[]> = {
  ASSIGNED: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['ARRIVED_AT_PICKUP', 'CANCELLED'],
  ARRIVED_AT_PICKUP: ['PICKED_UP', 'FAILED'],
  PICKED_UP: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
  DELIVERED: [],
  CANCELLED: [],
  FAILED: [],
};

// Delivery status -> matching Order status, for the statuses where the order
// pipeline actually mirrors delivery progress. ASSIGNED/ACCEPTED/
// ARRIVED_AT_PICKUP have no order-side equivalent (the order is already
// PARTNER_ASSIGNED); CANCELLED/FAILED are handled separately (they revert the
// order to READY_FOR_PICKUP for reassignment rather than mapping forward).
export const DELIVERY_TO_ORDER_STATUS: Record<string, string | undefined> = {
  PICKED_UP: 'PICKED_UP',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
};

export const DELIVERY_PARTNER_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  BLOCKED: 'BLOCKED',
} as const;

export const DELIVERY_PARTNER_AVAILABILITY = {
  OFFLINE: 'OFFLINE',
  ONLINE: 'ONLINE',
  BUSY: 'BUSY',
  ON_DELIVERY: 'ON_DELIVERY',
} as const;

export const DELIVERY_ISSUE_TYPES = {
  CUSTOMER_UNAVAILABLE: 'CUSTOMER_UNAVAILABLE',
  WRONG_ADDRESS: 'WRONG_ADDRESS',
  VENDOR_DELAY: 'VENDOR_DELAY',
  STORE_DELAY: 'STORE_DELAY',
  VEHICLE_PROBLEM: 'VEHICLE_PROBLEM',
  ORDER_MISSING: 'ORDER_MISSING',
  CUSTOMER_COMPLAINT: 'CUSTOMER_COMPLAINT',
  PAYMENT_ISSUE: 'PAYMENT_ISSUE',
  OTHER: 'OTHER',
} as const;

export const DELIVERY_ISSUE_STATUS = {
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const;
