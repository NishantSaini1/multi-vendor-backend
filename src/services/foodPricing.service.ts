import { VendorFoodItem, IVendorFoodItem } from '../models/VendorFoodItem';
import { FoodProduct, IFoodProduct } from '../models/FoodProduct';
import { FoodVariant, IFoodVariant } from '../models/FoodVariant';
import { ModifierGroup } from '../models/ModifierGroup';
import { ModifierOption } from '../models/ModifierOption';
import { IOrderItemModifier } from '../models/OrderItem';
import { ApiError } from '../utils/ApiError';
import { GENERIC_STATUS, GLOBAL_FOOD_ITEM_STATUS, VENDOR_FOOD_ITEM_AVAILABILITY } from '../constants/enums';

// Single source of truth for "resolve + validate + price one Food line item"
// — used by BOTH order.service.ts (checkout, whether from an inline items[]
// array or a Cart) and cart.service.ts (add/recompute a cart line), so the
// exact same rules apply everywhere a Food line item's price is ever
// determined. Never trust a client-supplied price/name — everything here is
// read fresh from the DB.
export interface ResolvedFoodLineItem {
  vendorFoodItem: IVendorFoodItem;
  globalItem: IFoodProduct;
  variant?: IFoodVariant;
  name: string;
  unitPrice: number;
  modifiers: IOrderItemModifier[];
  modifiersUnitTotal: number;
}

// Generic per-line price math shared by Food AND Instamart order lines
// (`discount`/`tax` are percentages; discount applies to the pre-tax line
// including addons/modifiers, tax applies after the discount) — lives here
// only because this is the first shared module Food pricing needed;
// order.service.ts imports it for its Instamart path too. This is a
// documented judgment call (the spec doesn't pin down the exact formula) —
// see README.
export function computeLine(unitPrice: number, quantity: number, discountPct: number, taxPct: number, addonsUnitTotal = 0) {
  const lineSubtotal = unitPrice * quantity;
  const addonsTotal = addonsUnitTotal * quantity;
  const lineDiscount = lineSubtotal * (discountPct / 100);
  const taxableBase = lineSubtotal - lineDiscount + addonsTotal;
  const lineTax = taxableBase * (taxPct / 100);
  const itemTotal = taxableBase + lineTax;
  return { lineSubtotal: lineSubtotal + addonsTotal, lineDiscount, lineTax, itemTotal };
}

// Validates and prices every selected modifier option for one line, enforcing
// each referenced ModifierGroup's required/min/max rules AND every OTHER
// required group on this same VendorFoodItem (a client can't skip a required
// group just by never mentioning it).
export async function resolveModifierSelections(
  vendorFoodItemId: string,
  selections: { modifierOptionId: string; quantity: number }[],
): Promise<{ snapshots: IOrderItemModifier[]; unitTotal: number }> {
  const allGroups = await ModifierGroup.find({ vendorFoodItemId, status: GENERIC_STATUS.ACTIVE });
  const groupById = new Map(allGroups.map((g) => [g.id, g]));

  const snapshots: IOrderItemModifier[] = [];
  let unitTotal = 0;
  const selectedCountByGroup = new Map<string, number>();

  if (selections.length > 0) {
    const optionIds = selections.map((s) => s.modifierOptionId);
    const options = await ModifierOption.find({ _id: { $in: optionIds }, status: GENERIC_STATUS.ACTIVE });
    const optionById = new Map(options.map((o) => [o.id, o]));

    for (const selection of selections) {
      const option = optionById.get(selection.modifierOptionId);
      const group = option ? groupById.get(option.modifierGroupId.toString()) : undefined;
      if (!option || !group) {
        throw ApiError.badRequest('Invalid modifier option for this item', 'INVALID_MODIFIER_OPTION');
      }

      selectedCountByGroup.set(group.id, (selectedCountByGroup.get(group.id) ?? 0) + selection.quantity);
      unitTotal += option.price * selection.quantity;
      snapshots.push({
        modifierGroupId: group._id,
        modifierOptionId: option._id,
        name: option.name,
        price: option.price,
        quantity: selection.quantity,
      });
    }
  }

  for (const group of allGroups) {
    const selectedCount = selectedCountByGroup.get(group.id) ?? 0;
    if (group.required && selectedCount === 0) {
      throw ApiError.badRequest(`"${group.name}" requires a selection`, 'MODIFIER_GROUP_REQUIRED');
    }
    if (selectedCount > 0 && (selectedCount < group.minSelection || selectedCount > group.maxSelection)) {
      throw ApiError.badRequest(
        `"${group.name}" requires between ${group.minSelection} and ${group.maxSelection} selections`,
        'MODIFIER_GROUP_SELECTION_INVALID',
      );
    }
  }

  return { snapshots, unitTotal };
}

// Resolves, validates, and prices ONE Food order/cart line from scratch.
// `expectedVendorId`, when given, enforces that this item belongs to that
// specific vendor (used by order.service.ts, which already knows the
// checkout's target vendor up front) — throwing the same PRODUCT_VENDOR_MISMATCH
// used there previously. Cart.service.ts omits it (a cart doesn't have a
// "target vendor" until its first item is added) and does its own
// cart-specific vendor-consistency check instead (CART_VENDOR_MISMATCH).
export async function resolveFoodLineItem(
  input: { vendorFoodItemId: string; variantId?: string; modifiers: { modifierOptionId: string; quantity: number }[] },
  expectedVendorId?: string,
): Promise<ResolvedFoodLineItem> {
  const vendorFoodItem = await VendorFoodItem.findById(input.vendorFoodItemId);
  if (!vendorFoodItem) throw ApiError.notFound(`Product ${input.vendorFoodItemId} not found`, 'PRODUCT_NOT_FOUND');
  if (expectedVendorId && vendorFoodItem.vendorId.toString() !== expectedVendorId) {
    throw ApiError.badRequest('All products in an order must belong to the same vendor', 'PRODUCT_VENDOR_MISMATCH');
  }
  if (
    vendorFoodItem.status !== GENERIC_STATUS.ACTIVE ||
    vendorFoodItem.availabilityStatus !== VENDOR_FOOD_ITEM_AVAILABILITY.AVAILABLE
  ) {
    throw ApiError.unprocessable('This item is not currently available', 'PRODUCT_NOT_AVAILABLE');
  }

  // name/foodType now live on the shared global FoodProduct this listing maps
  // onto (see foodProduct.service.ts) — a vendor's own listing can be ACTIVE
  // while the catalog entry it points at has since been deactivated by an
  // admin, so that must be re-checked here too, not just the listing's own
  // status above.
  const globalItem = await FoodProduct.findById(vendorFoodItem.globalFoodItemId);
  if (!globalItem || globalItem.status !== GLOBAL_FOOD_ITEM_STATUS.ACTIVE) {
    throw ApiError.unprocessable('This item is not currently available', 'PRODUCT_NOT_AVAILABLE');
  }

  let unitPrice = vendorFoodItem.price;
  let variant: IFoodVariant | undefined;
  if (input.variantId) {
    const found = await FoodVariant.findById(input.variantId);
    if (!found || found.vendorFoodItemId.toString() !== vendorFoodItem.id) {
      throw ApiError.badRequest('Invalid variant for this product', 'INVALID_VARIANT');
    }
    if (found.status !== GENERIC_STATUS.ACTIVE) {
      throw ApiError.unprocessable(`${globalItem.name} (${found.name}) is not currently available`, 'VARIANT_NOT_AVAILABLE');
    }
    variant = found;
    unitPrice = found.price;
  }

  const { snapshots: modifiers, unitTotal: modifiersUnitTotal } = await resolveModifierSelections(
    vendorFoodItem.id,
    input.modifiers,
  );

  return { vendorFoodItem, globalItem, variant, name: globalItem.name, unitPrice, modifiers, modifiersUnitTotal };
}
