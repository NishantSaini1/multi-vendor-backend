import mongoose from 'mongoose';
import { Inventory, IInventory } from '../models/Inventory';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';
import { INVENTORY_TRANSACTION_TYPES } from '../constants/enums';

type InventoryDoc = mongoose.HydratedDocument<IInventory>;

async function assertInventoryAccess(inventory: InventoryDoc, user: JwtPayload): Promise<void> {
  assertLocationAccess(user, inventory.locationId.toString());
}

export function inventoryListFilter(user: JwtPayload): Record<string, unknown> {
  return locationScopeFilter(user);
}

export async function listInventory(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    Inventory.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Inventory.countDocuments(filter),
  ]);
  return { items, total };
}

export async function getInventoryById(id: string, user: JwtPayload) {
  const inventory = await Inventory.findById(id);
  if (!inventory) throw ApiError.notFound('Inventory record not found', 'INVENTORY_NOT_FOUND');
  await assertInventoryAccess(inventory, user);
  return inventory;
}

export async function getInventoryByProduct(productId: string, user: JwtPayload) {
  const records = await Inventory.find({ productId });
  for (const record of records) {
    await assertInventoryAccess(record, user);
  }
  return records;
}

export async function getInventoryHistory(id: string, user: JwtPayload, pagination: PaginationParams) {
  const inventory = await getInventoryById(id, user);
  const [items, total] = await Promise.all([
    InventoryTransaction.find({ inventoryId: inventory.id })
      .sort(pagination.sort)
      .skip(pagination.skip)
      .limit(pagination.limit),
    InventoryTransaction.countDocuments({ inventoryId: inventory.id }),
  ]);
  return { items, total };
}

export async function getLowStockInventory(filter: Record<string, unknown>, pagination: PaginationParams) {
  const mongoFilter = { ...filter, $expr: { $lte: [{ $subtract: ['$currentStock', '$reservedStock'] }, '$minimumStock'] } };
  const [items, total] = await Promise.all([
    Inventory.find(mongoFilter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Inventory.countDocuments(mongoFilter),
  ]);
  return { items, total };
}

export async function getOutOfStockInventory(filter: Record<string, unknown>, pagination: PaginationParams) {
  const mongoFilter = { ...filter, $expr: { $lte: [{ $subtract: ['$currentStock', '$reservedStock'] }, 0] } };
  const [items, total] = await Promise.all([
    Inventory.find(mongoFilter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    Inventory.countDocuments(mongoFilter),
  ]);
  return { items, total };
}

function applyTransaction(inventory: InventoryDoc, type: string, quantity: number): void {
  switch (type) {
    case INVENTORY_TRANSACTION_TYPES.PURCHASE:
    case INVENTORY_TRANSACTION_TYPES.RETURN:
      inventory.currentStock += quantity;
      break;
    case INVENTORY_TRANSACTION_TYPES.SALE:
    case INVENTORY_TRANSACTION_TYPES.DAMAGE:
      if (inventory.currentStock < quantity) {
        throw ApiError.unprocessable('Insufficient stock for this transaction', 'INSUFFICIENT_STOCK');
      }
      inventory.currentStock -= quantity;
      break;
    case INVENTORY_TRANSACTION_TYPES.ADJUSTMENT:
      inventory.currentStock = quantity;
      break;
    case INVENTORY_TRANSACTION_TYPES.RESERVATION:
      if (inventory.currentStock - inventory.reservedStock < quantity) {
        throw ApiError.unprocessable('Insufficient available stock to reserve', 'INSUFFICIENT_STOCK');
      }
      inventory.reservedStock += quantity;
      break;
    case INVENTORY_TRANSACTION_TYPES.RELEASE:
      if (inventory.reservedStock < quantity) {
        throw ApiError.unprocessable('Cannot release more than is reserved', 'INVALID_RELEASE_QUANTITY');
      }
      inventory.reservedStock -= quantity;
      break;
    default:
      throw ApiError.badRequest(`Unknown inventory transaction type: ${type}`, 'INVALID_TRANSACTION_TYPE');
  }
}

export async function adjustInventory(
  data: { inventoryId?: string; storeId?: string; productId?: string; type: string; quantity: number; note?: string },
  user: JwtPayload,
  performedBy: string,
) {
  const session = await mongoose.startSession();
  try {
    let result: InventoryDoc | undefined;
    await session.withTransaction(async () => {
      const inventory = data.inventoryId
        ? await Inventory.findById(data.inventoryId).session(session)
        : await Inventory.findOne({ storeId: data.storeId, productId: data.productId }).session(session);

      if (!inventory) throw ApiError.notFound('Inventory record not found', 'INVENTORY_NOT_FOUND');
      await assertInventoryAccess(inventory, user);

      const stockBefore = inventory.currentStock;
      applyTransaction(inventory, data.type, data.quantity);
      await inventory.save({ session });

      await InventoryTransaction.create(
        [
          {
            inventoryId: inventory.id,
            storeId: inventory.storeId,
            productId: inventory.productId,
            type: data.type,
            quantity: data.quantity,
            stockBefore,
            stockAfter: inventory.currentStock,
            performedBy,
            note: data.note,
          },
        ],
        { session },
      );

      result = inventory;
    });
    return result!;
  } finally {
    await session.endSession();
  }
}

export async function bulkUpdateInventory(
  updates: { inventoryId: string; currentStock: number; note?: string }[],
  user: JwtPayload,
  performedBy: string,
) {
  const session = await mongoose.startSession();
  try {
    const results: InventoryDoc[] = [];
    await session.withTransaction(async () => {
      for (const update of updates) {
        const inventory = await Inventory.findById(update.inventoryId).session(session);
        if (!inventory) throw ApiError.notFound(`Inventory record ${update.inventoryId} not found`, 'INVENTORY_NOT_FOUND');
        await assertInventoryAccess(inventory, user);

        const stockBefore = inventory.currentStock;
        inventory.currentStock = update.currentStock;
        await inventory.save({ session });

        await InventoryTransaction.create(
          [
            {
              inventoryId: inventory.id,
              storeId: inventory.storeId,
              productId: inventory.productId,
              type: INVENTORY_TRANSACTION_TYPES.ADJUSTMENT,
              quantity: update.currentStock - stockBefore,
              stockBefore,
              stockAfter: inventory.currentStock,
              performedBy,
              note: update.note,
            },
          ],
          { session },
        );

        results.push(inventory);
      }
    });
    return results;
  } finally {
    await session.endSession();
  }
}

