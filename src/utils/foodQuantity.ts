// Human labels for a Food variant's type and quantity (see FoodVariant /
// VendorFoodItem models). Used to give a variant a sensible default name and
// to snapshot a readable label onto order lines.

export const VARIANT_TYPE_LABEL: Record<string, string> = {
  QUARTER_PLATE: 'Quarter Plate',
  HALF_PLATE: 'Half Plate',
  FULL_PLATE: 'Full Plate',
  HALF_PORTION: 'Half Portion',
  FULL_PORTION: 'Full Portion',
  SMALL: 'Small',
  REGULAR: 'Regular',
  MEDIUM: 'Medium',
  LARGE: 'Large',
  EXTRA_LARGE: 'Extra Large',
  MINI: 'Mini',
  SINGLE: 'Single',
  DOUBLE: 'Double',
  TRIPLE: 'Triple',
  JUMBO: 'Jumbo',
  SINGLE_SERVING: 'Single Serving',
  FAMILY_PACK: 'Family Pack',
  PARTY_PACK: 'Party Pack',
  HALF: 'Half',
  FULL: 'Full',
  QUARTER: 'Quarter',
  COMBO: 'Combo',
};

// [singular, plural]
const QUANTITY_UNIT_LABEL: Record<string, [string, string]> = {
  PIECE: ['Piece', 'Pieces'],
  PLATE: ['Plate', 'Plates'],
  BOWL: ['Bowl', 'Bowls'],
  CUP: ['Cup', 'Cups'],
  GLASS: ['Glass', 'Glasses'],
  THALI: ['Thali', 'Thalis'],
  ROTI: ['Roti', 'Rotis'],
  PARATHA: ['Paratha', 'Parathas'],
  SLICE: ['Slice', 'Slices'],
  GRAM: ['g', 'g'],
  KG: ['kg', 'kg'],
  ML: ['ml', 'ml'],
  LITRE: ['L', 'L'],
  PACKET: ['Packet', 'Packets'],
  PACK: ['Pack', 'Packs'],
  BOX: ['Box', 'Boxes'],
  BOTTLE: ['Bottle', 'Bottles'],
  CAN: ['Can', 'Cans'],
  DOZEN: ['Dozen', 'Dozen'],
  PAIR: ['Pair', 'Pairs'],
  COMBO: ['Combo', 'Combos'],
  SET: ['Set', 'Sets'],
};

// "6 Pieces", "500 g", "1 Plate" — '' when there is no quantity.
export function formatQuantity(value?: number | null, unit?: string | null): string {
  if (!value || !unit) return '';
  const [one, many] = QUANTITY_UNIT_LABEL[unit] ?? [unit, unit];
  return `${Number(value)} ${Number(value) === 1 ? one : many}`;
}

// The name a variant gets when the seller doesn't type one: its type
// ("Half Plate"), else its quantity ("6 Pieces").
export function defaultVariantName(variantType?: string | null, quantityValue?: number | null, quantityUnit?: string | null): string {
  return (variantType && VARIANT_TYPE_LABEL[variantType]) || formatQuantity(quantityValue, quantityUnit);
}
