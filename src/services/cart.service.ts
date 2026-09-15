import { Cart, ICart } from '../models/Cart';
import { CartItem, ICartItem } from '../models/CartItem';
import { ApiError } from '../utils/ApiError';
import { resolveFoodLineItem } from './foodPricing.service';

interface AddCartItemInput {
  vendorFoodItemId: string;
  variantId?: string;
  quantity: number;
  selectedModifierOptionIds?: string[];
}

// Cart selections carry no per-option quantity of their own (see CartItem.ts)
// — each selected id counts once toward its group's min/max/required rules,
// same as picking it once in a UI. Reuses the exact same resolve/validate/
// price logic order.service.ts uses at checkout (see foodPricing.service.ts)
// so a cart line and the order line it becomes are priced identically.
async function priceLine(data: { vendorFoodItemId: string; variantId?: string; selectedModifierOptionIds?: string[] }) {
  const modifiers = (data.selectedModifierOptionIds ?? []).map((modifierOptionId) => ({ modifierOptionId, quantity: 1 }));
  return resolveFoodLineItem({ vendorFoodItemId: data.vendorFoodItemId, variantId: data.variantId, modifiers });
}

export async function getOrCreateCart(customerId: string): Promise<ICart> {
  const existing = await Cart.findOne({ customerId });
  if (existing) return existing;
  return Cart.create({ customerId, vendorId: null });
}

async function findCartItemOrThrow(cartId: string, itemId: string): Promise<ICartItem> {
  const item = await CartItem.findOne({ _id: itemId, cartId });
  if (!item) throw ApiError.notFound('Cart item not found', 'CART_ITEM_NOT_FOUND');
  return item;
}

// Minimal local alias — avoids importing mongoose's Types just for this shape.
type ObjectIdLike = { toString(): string };

function sameModifierSet(a: ObjectIdLike[], b: string[]): boolean {
  const aIds = a.map((id) => id.toString()).sort();
  const bIds = [...b].sort();
  return aIds.length === bIds.length && aIds.every((id, i) => id === bIds[i]);
}

// Recomputes every line fresh from the DB on every read (never trusts the
// stored snapshot alone — prices/availability can change after a line is
// added). A line whose item/variant/modifier selection is no longer valid is
// still returned (flagged `unavailable: true`) rather than silently dropped
// or erroring the whole cart read — checkout re-validates strictly via
// order.service.ts's cartId path and will reject then if it's still invalid.
export async function getCart(customerId: string) {
  const cart = await getOrCreateCart(customerId);
  const items = await CartItem.find({ cartId: cart.id }).sort({ createdAt: 1 });

  const resolvedItems: Record<string, unknown>[] = [];
  let subtotal = 0;

  for (const item of items) {
    try {
      const resolved = await priceLine({
        vendorFoodItemId: item.vendorFoodItemId.toString(),
        variantId: item.variantId?.toString(),
        selectedModifierOptionIds: item.selectedModifierOptionIds.map((id) => id.toString()),
      });

      const itemTotal = (resolved.unitPrice + resolved.modifiersUnitTotal) * item.quantity;
      if (item.basePrice !== resolved.unitPrice || item.modifierAmount !== resolved.modifiersUnitTotal || item.itemTotal !== itemTotal) {
        item.basePrice = resolved.unitPrice;
        item.modifierAmount = resolved.modifiersUnitTotal;
        item.itemTotal = itemTotal;
        await item.save();
      }

      subtotal += itemTotal;
      resolvedItems.push({ ...item.toObject(), name: resolved.name, unavailable: false });
    } catch {
      resolvedItems.push({ ...item.toObject(), unavailable: true });
    }
  }

  return { cart, items: resolvedItems, subtotal };
}

export async function addItem(customerId: string, data: AddCartItemInput) {
  const cart = await getOrCreateCart(customerId);
  const resolved = await priceLine(data);
  const vendorId = resolved.vendorFoodItem.vendorId.toString();

  if (cart.vendorId && cart.vendorId.toString() !== vendorId) {
    throw new ApiError(
      409,
      'Your cart contains items from another vendor. Please clear the existing cart before adding items from this vendor.',
      'CART_VENDOR_MISMATCH',
    );
  }

  const selectedIds = data.selectedModifierOptionIds ?? [];

  // Merge into an existing line with the exact same item + variant + modifier
  // set instead of creating a duplicate row.
  const candidates = await CartItem.find({
    cartId: cart.id,
    vendorFoodItemId: data.vendorFoodItemId,
    variantId: data.variantId ?? null,
  });
  const existing = candidates.find((candidate) => sameModifierSet(candidate.selectedModifierOptionIds, selectedIds));

  const itemTotalPerUnit = resolved.unitPrice + resolved.modifiersUnitTotal;
  let cartItem: ICartItem;
  if (existing) {
    existing.quantity += data.quantity;
    existing.basePrice = resolved.unitPrice;
    existing.modifierAmount = resolved.modifiersUnitTotal;
    existing.itemTotal = itemTotalPerUnit * existing.quantity;
    await existing.save();
    cartItem = existing;
  } else {
    cartItem = await CartItem.create({
      cartId: cart.id,
      vendorFoodItemId: data.vendorFoodItemId,
      variantId: data.variantId,
      quantity: data.quantity,
      selectedModifierOptionIds: selectedIds,
      basePrice: resolved.unitPrice,
      modifierAmount: resolved.modifiersUnitTotal,
      itemTotal: itemTotalPerUnit * data.quantity,
    });
  }

  if (!cart.vendorId) {
    cart.vendorId = resolved.vendorFoodItem.vendorId;
    await cart.save();
  }

  return cartItem;
}

export async function updateItemQuantity(customerId: string, cartItemId: string, quantity: number) {
  const cart = await getOrCreateCart(customerId);
  const item = await findCartItemOrThrow(cart.id, cartItemId);

  const resolved = await priceLine({
    vendorFoodItemId: item.vendorFoodItemId.toString(),
    variantId: item.variantId?.toString(),
    selectedModifierOptionIds: item.selectedModifierOptionIds.map((id) => id.toString()),
  });

  item.quantity = quantity;
  item.basePrice = resolved.unitPrice;
  item.modifierAmount = resolved.modifiersUnitTotal;
  item.itemTotal = (resolved.unitPrice + resolved.modifiersUnitTotal) * quantity;
  await item.save();
  return item;
}

export async function removeItem(customerId: string, cartItemId: string): Promise<void> {
  const cart = await getOrCreateCart(customerId);
  await findCartItemOrThrow(cart.id, cartItemId);
  await CartItem.deleteOne({ _id: cartItemId, cartId: cart.id });

  const remaining = await CartItem.countDocuments({ cartId: cart.id });
  if (remaining === 0 && cart.vendorId) {
    cart.vendorId = null;
    await cart.save();
  }
}

export async function clearCart(customerId: string): Promise<void> {
  const cart = await getOrCreateCart(customerId);
  await CartItem.deleteMany({ cartId: cart.id });
  cart.vendorId = null;
  await cart.save();
}
