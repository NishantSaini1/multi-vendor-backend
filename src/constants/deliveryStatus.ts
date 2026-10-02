export const DELIVERY_STATUS = {
  ASSIGNED: 'ASSIGNED',
  ARRIVED_AT_VENDOR: 'ARRIVED_AT_VENDOR',
  PICKED_UP: 'PICKED_UP',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  ARRIVED_AT_CUSTOMER: 'ARRIVED_AT_CUSTOMER',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;

export type DeliveryStatusType = (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS];

// Valid forward transitions via PATCH /deliveries/:id/status.
// ARRIVED_AT_VENDOR→PICKED_UP and ARRIVED_AT_CUSTOMER→DELIVERED are intentionally
// omitted here — those transitions require OTP verification + image upload and are
// handled by the dedicated POST /:id/verify-pickup and POST /:id/verify-delivery endpoints.
export const DELIVERY_TRANSITIONS: Record<string, string[]> = {
  ASSIGNED: ['ARRIVED_AT_VENDOR', 'CANCELLED'],
  ARRIVED_AT_VENDOR: ['FAILED'],
  PICKED_UP: ['OUT_FOR_DELIVERY'],
  OUT_FOR_DELIVERY: ['ARRIVED_AT_CUSTOMER', 'FAILED'],
  ARRIVED_AT_CUSTOMER: ['FAILED'],
  DELIVERED: [],
  CANCELLED: [],
  FAILED: [],
};

// Delivery status -> matching Order status, for the statuses where the order
// pipeline mirrors delivery progress. ASSIGNED/ARRIVED_AT_VENDOR/
// ARRIVED_AT_CUSTOMER have no order-side equivalent (the order is already
// PARTNER_ASSIGNED); CANCELLED/FAILED revert the order to READY_FOR_PICKUP.
export const DELIVERY_TO_ORDER_STATUS: Record<string, string | undefined> = {
  PICKED_UP: 'PICKED_UP',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
};

export const DELIVERY_ASSIGNMENT_MODE = {
  AUTO: 'AUTO',
  MANUAL: 'MANUAL',
} as const;

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
