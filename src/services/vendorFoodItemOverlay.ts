// A vendor can customise how its own listing of a catalog item looks (name,
// description, photos, food type, category/subcategory) without touching the
// shared FoodProduct. These helpers apply that vendor's overrides on top of the
// catalog values wherever a VendorFoodItem is served.

export const OVERRIDE_FIELDS = ['name', 'description', 'images', 'foodType', 'categoryId', 'subcategoryId'] as const;

type Json = Record<string, unknown>;

function isSet(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

// For a VendorFoodItem JSON whose `globalFoodItemId` is populated with the
// catalog item: returns it with the vendor's overrides applied onto that
// embedded object (and the override fields dropped from the top level so the
// response shape stays "catalog item under globalFoodItemId").
export function withVendorOverrides<T extends Json>(item: T): T {
  const global = item.globalFoodItemId;
  const next: Json = { ...item };
  if (global && typeof global === 'object') {
    const merged: Json = { ...(global as Json) };
    for (const field of OVERRIDE_FIELDS) {
      if (isSet(item[field])) merged[field] = item[field];
    }
    // A subcategory only makes sense under its own category — if the vendor
    // moved the item to another category without picking a subcategory, drop
    // the catalog's subcategory instead of leaving a mismatched pair.
    if (isSet(item.categoryId) && !isSet(item.subcategoryId)) merged.subcategoryId = null;
    next.globalFoodItemId = merged;
  }
  return next as T;
}

// Mongo filter matching listings whose EFFECTIVE category (override, else
// catalog) is one of `categoryIds` — used where the code used to query the
// catalog's categoryId directly.
export function effectiveCategoryFilter(categoryIds: unknown[], catalogItemIdsInCategory: unknown[]): Json {
  return {
    $or: [
      { categoryId: { $in: categoryIds } },
      { categoryId: { $exists: false }, globalFoodItemId: { $in: catalogItemIdsInCategory } },
      { categoryId: null, globalFoodItemId: { $in: catalogItemIdsInCategory } },
    ],
  };
}
