import { ClientSession } from 'mongoose';
import { Transaction } from '../models/Transaction';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { TRANSACTION_STATUS, TRANSACTION_TYPE, TRANSACTION_DIRECTION } from '../constants/enums';

interface RecordTransactionInput {
  orderId?: string;
  vendorId?: string;
  storeId?: string;
  deliveryPartnerId?: string;
  type: string;
  amount: number;
  direction: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

// Thin create wrapper — the ONLY place a Transaction row is ever written, so
// every caller (payment/order/delivery/refund/settlement services) goes
// through the same validation. Accepts an optional mongoose session so it can
// be recorded atomically alongside whatever DB write it accompanies (e.g. the
// WALLET-payment path in order.service.ts's createOrder, or the delivery
// status transition in delivery.service.ts).
export async function recordTransaction(data: RecordTransactionInput, session?: ClientSession) {
  if (!(data.amount > 0)) {
    throw ApiError.badRequest('Transaction amount must be greater than 0', 'INVALID_TRANSACTION_AMOUNT');
  }

  const [transaction] = await Transaction.create(
    [
      {
        orderId: data.orderId,
        vendorId: data.vendorId,
        storeId: data.storeId,
        deliveryPartnerId: data.deliveryPartnerId,
        type: data.type,
        amount: data.amount,
        direction: data.direction,
        status: data.status ?? TRANSACTION_STATUS.COMPLETED,
        metadata: data.metadata,
      },
    ],
    { session },
  );

  return transaction;
}

// An order reaching DELIVERED records its commission snapshot as a real
// ledger entry — called from BOTH order.service.ts's updateOrderStatus (a
// direct admin PATCH straight to DELIVERED) and delivery.service.ts's
// updateDeliveryStatus (the actual, expected path — a delivery reaching
// DELIVERED sets order.status = DELIVERED directly, bypassing
// updateOrderStatus entirely). Centralized here so the two call sites can
// never drift. Uses the SNAPSHOT taken at order creation
// (order.commissionAmount), never recomputed. PLATFORM_FEE mirrors the
// commission 1:1 — under the current model the commission taken from the
// vendor/store IS the platform's revenue on that order (there's no
// independently-configured platform fee yet; `order.platformFee` stays 0 in
// every path today). A no-op when the order has no commission snapshot (100%
// payable, nothing for the platform to take).
export async function recordOrderCommissionLedger(
  order: {
    id?: string;
    vendorId?: { toString(): string } | string;
    storeId?: { toString(): string } | string;
    commissionAmount?: number;
  },
  session?: ClientSession,
): Promise<void> {
  if (!order.commissionAmount) return;

  await recordTransaction(
    {
      orderId: order.id,
      vendorId: order.vendorId?.toString(),
      storeId: order.storeId?.toString(),
      type: TRANSACTION_TYPE.VENDOR_COMMISSION,
      amount: order.commissionAmount,
      direction: TRANSACTION_DIRECTION.DEBIT,
    },
    session,
  );
  await recordTransaction(
    {
      orderId: order.id,
      type: TRANSACTION_TYPE.PLATFORM_FEE,
      amount: order.commissionAmount,
      direction: TRANSACTION_DIRECTION.CREDIT,
    },
    session,
  );
}

// Admin-only, read-only browse of the ledger (see ledger.routes.ts).
export async function listTransactions(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Transaction.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Transaction.countDocuments(filter),
  ]);
  return { items, total };
}
