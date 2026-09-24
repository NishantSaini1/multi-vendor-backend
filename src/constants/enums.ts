export const VENDOR_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;

export const APPROVAL_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export const STORE_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;

// Onboarding/approval workflow — separate from STORE_STATUS (which is the
// operational open/closed-for-business signal). DRAFT covers a store still
// being onboarded (e.g. a multi-step wizard not yet submitted); PENDING is
// submitted-awaiting-admin-review; mirrors Vendor's APPROVAL_STATUS with an
// added DRAFT state.
export const STORE_APPROVAL_STATUS = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

// Store specialization (Grocery, Veg & Fruits, Cosmetics, ...) is a real
// admin-managed entity now — see models/StoreType.ts — not a fixed enum here.

export const GENERIC_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;

// Global Food Item (FoodProduct) dietary classification.
export const FOOD_TYPE = {
  VEG: 'VEG',
  NON_VEG: 'NON_VEG',
  EGG: 'EGG',
  VEGAN: 'VEGAN',
} as const;

// FoodProduct (the global, admin-managed catalog item) lifecycle — distinct
// from GENERIC_STATUS since an item can be awaiting/rejected from a vendor's
// FoodItemSubmission, not just ACTIVE/INACTIVE.
export const GLOBAL_FOOD_ITEM_STATUS = {
  ACTIVE: 'ACTIVE',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  REJECTED: 'REJECTED',
  INACTIVE: 'INACTIVE',
} as const;

// VendorFoodItem's day-to-day stock/availability signal — distinct from its
// own `status` (whether the vendor still lists this item at all).
export const VENDOR_FOOD_ITEM_AVAILABILITY = {
  AVAILABLE: 'AVAILABLE',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  INACTIVE: 'INACTIVE',
} as const;

// A vendor's "this item doesn't exist in the catalog yet" submission,
// reviewed by an admin (see FoodItemSubmission.ts / foodItemSubmission.service.ts).
export const FOOD_ITEM_SUBMISSION_STATUS = {
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;

export const CUSTOMER_STATUS = {
  ACTIVE: 'ACTIVE',
  BLOCKED: 'BLOCKED',
} as const;

export const ADDRESS_TYPES = {
  HOME: 'HOME',
  WORK: 'WORK',
  OTHER: 'OTHER',
} as const;

export const DISCOUNT_TYPES = {
  PERCENTAGE: 'PERCENTAGE',
  FIXED: 'FIXED',
} as const;

export const COMMISSION_LEVELS = {
  GLOBAL: 'GLOBAL',
  LOCATION: 'LOCATION',
  VENDOR: 'VENDOR',
  STORE: 'STORE',
} as const;

export const INVENTORY_TRANSACTION_TYPES = {
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  RETURN: 'RETURN',
  DAMAGE: 'DAMAGE',
  ADJUSTMENT: 'ADJUSTMENT',
  RESERVATION: 'RESERVATION',
  RELEASE: 'RELEASE',
} as const;

export const NOTIFICATION_TYPES = {
  ORDER_CREATED: 'ORDER_CREATED',
  // Vendor-facing: a customer placed an order at this vendor (rings the
  // vendor app's siren channel — see notification.service PUSH_OPTIONS_BY_TYPE).
  NEW_ORDER: 'NEW_ORDER',
  ORDER_CONFIRMED: 'ORDER_CONFIRMED',
  ORDER_PREPARING: 'ORDER_PREPARING',
  ORDER_READY: 'ORDER_READY',
  PARTNER_ASSIGNED: 'PARTNER_ASSIGNED',
  ORDER_PICKED_UP: 'ORDER_PICKED_UP',
  ORDER_OUT_FOR_DELIVERY: 'ORDER_OUT_FOR_DELIVERY',
  ORDER_DELIVERED: 'ORDER_DELIVERED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
  REFUND_COMPLETED: 'REFUND_COMPLETED',
  SETTLEMENT_COMPLETED: 'SETTLEMENT_COMPLETED',
} as const;

export const REVIEW_TARGET_TYPES = {
  VENDOR: 'VENDOR',
  STORE: 'STORE',
  PRODUCT: 'PRODUCT',
  DELIVERY_PARTNER: 'DELIVERY_PARTNER',
} as const;

export const REVIEW_STATUS = {
  VISIBLE: 'VISIBLE',
  HIDDEN: 'HIDDEN',
} as const;

export const BANNER_PLACEMENTS = {
  GLOBAL: 'GLOBAL',
  LOCATION: 'LOCATION',
  FOOD: 'FOOD',
  INSTAMART: 'INSTAMART',
  VENDOR: 'VENDOR',
  STORE: 'STORE',
} as const;

export const DEVICE_TYPES = {
  ANDROID: 'ANDROID',
  IOS: 'IOS',
  WEB: 'WEB',
} as const;

// A vendor's weekly operating-hours schedule (Vendor.businessHours) — see
// models/Vendor.ts.
export const DAYS_OF_WEEK = {
  MONDAY: 'MONDAY',
  TUESDAY: 'TUESDAY',
  WEDNESDAY: 'WEDNESDAY',
  THURSDAY: 'THURSDAY',
  FRIDAY: 'FRIDAY',
  SATURDAY: 'SATURDAY',
  SUNDAY: 'SUNDAY',
} as const;

// The financial ledger (Transaction.ts / ledger.service.ts) — every money
// movement the platform ever records, so settlement generation can source
// from history instead of live-recomputing commission.
export const TRANSACTION_TYPE = {
  ORDER_PAYMENT: 'ORDER_PAYMENT',
  VENDOR_COMMISSION: 'VENDOR_COMMISSION',
  DELIVERY_EARNING: 'DELIVERY_EARNING',
  PLATFORM_FEE: 'PLATFORM_FEE',
  REFUND: 'REFUND',
  VENDOR_SETTLEMENT: 'VENDOR_SETTLEMENT',
  DELIVERY_SETTLEMENT: 'DELIVERY_SETTLEMENT',
  ADJUSTMENT: 'ADJUSTMENT',
} as const;

export const TRANSACTION_DIRECTION = {
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT',
} as const;

// Most ledger entries are written as a fait-accompli record of something that
// already happened (a payment that cleared, a commission already taken) —
// COMPLETED is the default; PENDING/REVERSED exist for future use (e.g. a
// disputed/reversed transaction) without needing a schema change later.
export const TRANSACTION_STATUS = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  REVERSED: 'REVERSED',
} as const;

// Refund.reason — was a free string; now a closed set so refund analytics/
// reporting can actually group by cause. Free-text detail still has a home
// via Refund.reasonDetail.
export const REFUND_REASON = {
  VENDOR_REJECTED: 'VENDOR_REJECTED',
  CUSTOMER_CANCELLED: 'CUSTOMER_CANCELLED',
  PAYMENT_FAILURE: 'PAYMENT_FAILURE',
  ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  DELIVERY_FAILURE: 'DELIVERY_FAILURE',
  ADMIN_REFUND: 'ADMIN_REFUND',
  OTHER: 'OTHER',
} as const;
