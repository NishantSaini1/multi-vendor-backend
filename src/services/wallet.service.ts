import mongoose, { ClientSession } from 'mongoose';
import { Wallet, IWallet } from '../models/Wallet';
import { WalletTransaction } from '../models/WalletTransaction';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { WALLET_TRANSACTION_TYPES } from '../constants/paymentStatus';

type WalletDoc = mongoose.HydratedDocument<IWallet>;

export async function getOrCreateWallet(customerId: string, session?: ClientSession): Promise<WalletDoc> {
  let wallet = await Wallet.findOne({ customerId }).session(session ?? null);
  if (!wallet) {
    const [created] = await Wallet.create([{ customerId, balance: 0 }], { session });
    wallet = created;
  }
  return wallet;
}

function assertOwnWallet(user: JwtPayload, customerId: string): void {
  if (user.userType !== 'CUSTOMER' || user.userId !== customerId) {
    throw ApiError.forbidden('You do not have access to this wallet', 'WALLET_FORBIDDEN');
  }
}

export async function getWalletForCustomer(customerId: string, user: JwtPayload) {
  if (user.userType === 'CUSTOMER') assertOwnWallet(user, customerId);
  return getOrCreateWallet(customerId);
}

export async function listWalletTransactions(customerId: string, user: JwtPayload, pagination: PaginationParams) {
  if (user.userType === 'CUSTOMER') assertOwnWallet(user, customerId);
  const filter = { customerId };
  const [items, total] = await Promise.all([
    WalletTransaction.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    WalletTransaction.countDocuments(filter),
  ]);
  return { items, total };
}

// Debits `amount` from the customer's wallet within the caller's transaction
// session — the caller is responsible for the session (order creation debits
// as part of the larger order-creation transaction). Throws if the balance is
// insufficient; never allows balance to go negative.
export async function debitWallet(
  customerId: string,
  amount: number,
  type: string,
  reference: string | undefined,
  note: string | undefined,
  session: ClientSession,
): Promise<WalletDoc> {
  const wallet = await getOrCreateWallet(customerId, session);
  if (wallet.balance < amount) {
    throw ApiError.unprocessable('Insufficient wallet balance', 'INSUFFICIENT_WALLET_BALANCE');
  }
  const balanceBefore = wallet.balance;
  wallet.balance -= amount;
  await wallet.save({ session });

  await WalletTransaction.create(
    [
      {
        walletId: wallet.id,
        customerId,
        type,
        amount,
        balanceBefore,
        balanceAfter: wallet.balance,
        reference,
        note,
      },
    ],
    { session },
  );

  return wallet;
}

// Credits `amount` to the customer's wallet. Runs in its own transaction when
// the caller doesn't already have one (admin adjustments, refunds-to-wallet
// initiated outside an order transaction); pass `session` to join an existing
// one instead (there is currently no such caller, but the option mirrors
// `debitWallet` for symmetry and future reuse).
export async function creditWallet(
  customerId: string,
  amount: number,
  type: string,
  reference: string | undefined,
  note: string | undefined,
  session?: ClientSession,
): Promise<WalletDoc> {
  const run = async (activeSession: ClientSession) => {
    const wallet = await getOrCreateWallet(customerId, activeSession);
    const balanceBefore = wallet.balance;
    wallet.balance += amount;
    await wallet.save({ session: activeSession });

    await WalletTransaction.create(
      [
        {
          walletId: wallet.id,
          customerId,
          type,
          amount,
          balanceBefore,
          balanceAfter: wallet.balance,
          reference,
          note,
        },
      ],
      { session: activeSession },
    );

    return wallet;
  };

  if (session) return run(session);

  const ownSession = await mongoose.startSession();
  try {
    let result: WalletDoc | undefined;
    await ownSession.withTransaction(async () => {
      result = await run(ownSession);
    });
    return result!;
  } finally {
    await ownSession.endSession();
  }
}

export async function adminAdjustWallet(
  customerId: string,
  amount: number,
  type: 'CREDIT' | 'DEBIT' | 'ADJUSTMENT' | 'CASHBACK',
  note: string | undefined,
  performedBy: string,
) {
  if (type === 'DEBIT') {
    const session = await mongoose.startSession();
    try {
      let result: WalletDoc | undefined;
      await session.withTransaction(async () => {
        result = await debitWallet(customerId, amount, WALLET_TRANSACTION_TYPES.DEBIT, `ADMIN:${performedBy}`, note, session);
      });
      return result!;
    } finally {
      await session.endSession();
    }
  }
  return creditWallet(customerId, amount, type, `ADMIN:${performedBy}`, note);
}
