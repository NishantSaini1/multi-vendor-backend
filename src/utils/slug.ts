// Shared kebab-case slug generation used by every global, admin-managed
// taxonomy model that carries a unique `slug` field derived from `name`
// (VendorType, FoodCategory, FoodSubcategory, ...).
export function slugify(value: string): string {
  return value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
