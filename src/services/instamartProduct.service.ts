import mongoose from 'mongoose';
import { InstamartProduct } from '../models/InstamartProduct';
import { InstamartVariant } from '../models/InstamartVariant';
import { InstamartGlobalProduct, IInstamartGlobalProduct } from '../models/InstamartGlobalProduct';
import { Inventory } from '../models/Inventory';
import { Store } from '../models/Store';
import { ApiError } from '../utils/ApiError';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { assertOwnerOrLocationAccess, locationScopeFilter } from '../middleware/rbac.middleware';
import { APPROVAL_STATUS, GENERIC_STATUS } from '../constants/enums';
import { assertCategoryAndSubcategory } from './instamartGlobalProduct.service';

export function instamartProductListFilter(user: JwtPayload): Record<string, unknown> {
  if (user.userType === 'STORE') return { storeId: user.userId };
  if (user.userType === 'CUSTOMER') return { status: GENERIC_STATUS.ACTIVE };
  return locationScopeFilter(user);
}

// submittedByStoreId is included so a store's own app can tell whether it's
// allowed to edit this product further (see
// instamartGlobalProduct.service.ts's updateInstamartGlobalProduct) without
// a separate round trip. categoryId/subcategoryId are included too so an
// edit form can be pre-filled with the product's full current classification.
const GLOBAL_PRODUCT_FIELDS =
  'name brand description categoryId subcategoryId unit packSize weight images barcode hsn gst mrp approvalStatus status submittedByStoreId';

// A global product only ever reaches a CUSTOMER once both halves of the
// listing are live: the store's own mapping (status) AND the shared catalog
// entry it points at (approvalStatus/status). A store's own "propose a new
// product" is auto-approved (see createInstamartProduct), so this gate
// mainly matters for a product an admin has separately marked
// PENDING/REJECTED/INACTIVE.
export function globalProductVisible(globalProduct: Pick<IInstamartGlobalProduct, 'approvalStatus' | 'status'> | null | undefined): boolean {
  return !!globalProduct && globalProduct.approvalStatus === APPROVAL_STATUS.APPROVED && globalProduct.status === GENERIC_STATUS.ACTIVE;
}

// Attaches `hasVariants` + a "starting from" price/mrp onto each
// already-enriched listing. The listing's own sellingPrice/mrp (its own pack
// size/unit — e.g. "1 Kg") is itself always a valid, orderable choice (see
// order.service.ts) alongside any named variant, not superseded by one — so
// the "from" price is whichever is actually cheapest: a store-marked default
// variant (which always wins outright, regardless of price), else the lower
// of the base listing's own price and its cheapest ACTIVE variant. This must
// stay in lockstep with the customer app's own preselection fallback (see
// InstamartProductDetailScreen's `load`) so the price shown here always
// matches the pack size that actually ends up preselected.
//
// sellingPrice/mrp themselves are left untouched on the response — the
// STORE/ADMIN product-edit views read those as the raw editable listing
// fields — this only adds the three new fields.
async function attachVariantInfo(enriched: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (enriched.length === 0) return enriched;
  const ids = enriched.map((p) => p._id as mongoose.Types.ObjectId);
  const stats = await InstamartVariant.aggregate([
    { $match: { productId: { $in: ids }, status: GENERIC_STATUS.ACTIVE } },
    { $sort: { isDefault: -1, sellingPrice: 1 } },
    {
      $group: {
        _id: '$productId',
        isDefault: { $first: '$isDefault' },
        variantPriceFrom: { $first: '$sellingPrice' },
        variantMrpFrom: { $first: '$mrp' },
      },
    },
  ]);
  const statsByProductId = new Map(stats.map((s) => [s._id.toString(), s]));
  return enriched.map((plain) => {
    const stat = statsByProductId.get((plain._id as mongoose.Types.ObjectId).toString());
    const basePrice = plain.sellingPrice as number;
    const baseMrp = plain.mrp as number;
    let priceFrom = basePrice;
    let mrpFrom = baseMrp;
    if (stat && (stat.isDefault || stat.variantPriceFrom < basePrice)) {
      priceFrom = stat.variantPriceFrom;
      mrpFrom = stat.variantMrpFrom;
    }
    return {
      ...plain,
      hasVariants: !!stat,
      variantPriceFrom: priceFrom,
      variantMrpFrom: mrpFrom,
    };
  });
}

// Flattens the joined global product's display fields (name, brand, images,
// MRP, ...) onto the store-mapping response, alongside a nested `product`
// object carrying the full global record (hsn/gst/description/approvalStatus
// included) and the existing store snapshot — a marketplace customer
// browsing a shared category needs to know both which product it is and
// which store is selling it, since the same product/category can be listed
// by several independent stores.
async function withGlobalProduct(product: InstanceType<typeof InstamartProduct>): Promise<Record<string, unknown> | null> {
  const plain = product.toObject() as unknown as Record<string, unknown>;
  const globalProduct = await InstamartGlobalProduct.findById(product.productId).select(GLOBAL_PRODUCT_FIELDS);
  if (!globalProduct) return null;
  Object.assign(plain, {
    name: globalProduct.name,
    brand: globalProduct.brand,
    description: globalProduct.description,
    unit: globalProduct.unit,
    packSize: globalProduct.packSize,
    weight: globalProduct.weight,
    images: globalProduct.images,
    barcode: globalProduct.barcode,
    mrp: globalProduct.mrp,
  });
  plain.product = globalProduct;
  const [withVariantInfo] = await attachVariantInfo([plain]);
  return withVariantInfo;
}

// Exported for store.service.ts's getStoreProducts, which lists a single
// store's own mappings and needs the same global-product flattening as
// listInstamartProducts above, without the store snapshot (the caller
// already knows which store it is).
export async function withGlobalProducts(products: InstanceType<typeof InstamartProduct>[]): Promise<Record<string, unknown>[]> {
  const productIds = [...new Set(products.map((p) => p.productId.toString()))];
  const globalProducts = await InstamartGlobalProduct.find({ _id: { $in: productIds } }).select(GLOBAL_PRODUCT_FIELDS);
  const globalById = new Map(globalProducts.map((g) => [g._id.toString(), g]));
  const mapped = products
    .map((product) => {
      const globalProduct = globalById.get(product.productId.toString());
      if (!globalProduct) return null;
      const plain = product.toObject() as unknown as Record<string, unknown>;
      Object.assign(plain, {
        name: globalProduct.name,
        brand: globalProduct.brand,
        description: globalProduct.description,
        unit: globalProduct.unit,
        packSize: globalProduct.packSize,
        weight: globalProduct.weight,
        images: globalProduct.images,
        barcode: globalProduct.barcode,
        mrp: globalProduct.mrp,
      });
      plain.product = globalProduct;
      return plain;
    })
    .filter((p): p is Record<string, unknown> => p !== null);
  return attachVariantInfo(mapped);
}

// Attaches a { _id, name, logo, rating, ratingCount } store snapshot onto
// each product — a marketplace customer browsing a shared category needs to
// know which store a given listing belongs to, since the same product/category
// can be listed by several independent stores.
async function withStore(plain: Record<string, unknown>, storeId: mongoose.Types.ObjectId): Promise<Record<string, unknown>> {
  const store = await Store.findById(storeId).select('name logo rating ratingCount');
  if (store) plain.store = { _id: store._id, name: store.name, logo: store.logo, rating: store.rating, ratingCount: store.ratingCount };
  return plain;
}

async function withStores(products: Record<string, unknown>[], storeIdOf: (p: Record<string, unknown>) => string): Promise<Record<string, unknown>[]> {
  const storeIds = [...new Set(products.map(storeIdOf))];
  const stores = await Store.find({ _id: { $in: storeIds } }).select('name logo rating ratingCount');
  const storeById = new Map(stores.map((s) => [s._id.toString(), s]));
  return products.map((plain) => {
    const store = storeById.get(storeIdOf(plain));
    if (store) plain.store = { _id: store._id, name: store.name, logo: store.logo, rating: store.rating, ratingCount: store.ratingCount };
    return plain;
  });
}

// A store is its own owner (its JWT userId is the Store's own _id, the same
// id every product's storeId points at), so this reuses the ownerId/locationId
// helper the same way Vendor's product ownership does.
async function resolveStore(
  data: { storeId?: string },
  user: JwtPayload,
): Promise<InstanceType<typeof Store>> {
  if (user.userType === 'STORE') {
    const store = await Store.findById(user.userId);
    if (!store) throw ApiError.notFound('Store not found', 'STORE_NOT_FOUND');
    return store;
  }

  if (!data.storeId) throw ApiError.badRequest('storeId is required', 'STORE_ID_REQUIRED');
  const store = await Store.findById(data.storeId);
  if (!store) throw ApiError.notFound('Store not found', 'STORE_NOT_FOUND');
  assertOwnerOrLocationAccess(user, store.id, store.locationId.toString());
  return store;
}

export async function listInstamartProducts(filter: Record<string, unknown>, pagination: PaginationParams, user: JwtPayload) {
  // Re-asserted here (not just in instamartProductListFilter) so an
  // admin-only ?status= query param merged in the controller can never leak
  // non-active products to a customer.
  const query = user.userType === 'CUSTOMER' ? { ...filter, status: GENERIC_STATUS.ACTIVE } : filter;
  const [items, total] = await Promise.all([
    InstamartProduct.find(query).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    InstamartProduct.countDocuments(query),
  ]);

  let enriched = await withGlobalProducts(items);
  // A CUSTOMER may only ever see a listing whose global product is also
  // APPROVED + ACTIVE — enforced here (not just via the join itself, which
  // already drops nulls) as a second, explicit gate.
  if (user.userType === 'CUSTOMER') {
    enriched = enriched.filter((p) => globalProductVisible((p.product as IInstamartGlobalProduct | undefined) ?? null));
  }
  enriched = await withStores(enriched, (p) => (p.storeId as mongoose.Types.ObjectId).toString());
  return { items: enriched, total };
}

export async function createInstamartProduct(
  data: {
    storeId?: string;
    productId?: string;
    newProduct?: Record<string, unknown>;
    sku?: string;
    sellingPrice: number;
    discount?: number;
    sortOrder?: number;
  },
  user: JwtPayload,
) {
  const store = await resolveStore({ storeId: data.storeId }, user);

  const session = await mongoose.startSession();
  try {
    let product: InstanceType<typeof InstamartProduct> | undefined;
    await session.withTransaction(async () => {
      let globalProductId: string;
      let categoryId: mongoose.Types.ObjectId;
      let subcategoryId: mongoose.Types.ObjectId | undefined;

      if (data.productId) {
        // Option A: map onto an existing, already-approved catalog entry.
        const globalProduct = await InstamartGlobalProduct.findById(data.productId).session(session);
        if (!globalProduct) throw ApiError.notFound('Instamart global product not found', 'INSTAMART_GLOBAL_PRODUCT_NOT_FOUND');
        if (globalProduct.approvalStatus !== APPROVAL_STATUS.APPROVED) {
          throw ApiError.badRequest('This product is not yet approved for listing', 'GLOBAL_PRODUCT_NOT_APPROVED');
        }
        globalProductId = globalProduct.id;
        categoryId = globalProduct.categoryId;
        subcategoryId = globalProduct.subcategoryId;
      } else {
        // Option B: propose a brand-new catalog entry — auto-approved
        // immediately (no admin review gate for a store's own new product);
        // submittedByStoreId is kept purely as an audit trail of who added it.
        await assertCategoryAndSubcategory(data.newProduct!.categoryId as string, data.newProduct!.subcategoryId as string | undefined);
        const [created] = await InstamartGlobalProduct.create(
          [
            {
              ...data.newProduct,
              approvalStatus: APPROVAL_STATUS.APPROVED,
              submittedByStoreId: store.id,
            },
          ],
          { session },
        );
        globalProductId = created.id;
        categoryId = created.categoryId;
        subcategoryId = created.subcategoryId;
      }

      const [created] = await InstamartProduct.create(
        [
          {
            locationId: store.locationId,
            storeId: store.id,
            productId: globalProductId,
            categoryId,
            subcategoryId,
            sku: data.sku,
            sellingPrice: data.sellingPrice,
            discount: data.discount ?? 0,
            sortOrder: data.sortOrder ?? 0,
          },
        ],
        { session },
      );
      product = created;
      await Inventory.create(
        [
          {
            locationId: store.locationId,
            storeId: store.id,
            productId: created.id,
            currentStock: 0,
            reservedStock: 0,
          },
        ],
        { session },
      );
    });
    return product!;
  } finally {
    await session.endSession();
  }
}

async function findProductOrThrow(id: string) {
  const product = await InstamartProduct.findById(id);
  if (!product) throw ApiError.notFound('Instamart product not found', 'INSTAMART_PRODUCT_NOT_FOUND');
  return product;
}

export async function getInstamartProductById(id: string, user: JwtPayload) {
  const product = await findProductOrThrow(id);
  const enriched = await withGlobalProduct(product);
  if (user.userType === 'CUSTOMER') {
    if (product.status !== GENERIC_STATUS.ACTIVE || !enriched || !globalProductVisible(enriched.product as IInstamartGlobalProduct)) {
      throw ApiError.notFound('Instamart product not found', 'INSTAMART_PRODUCT_NOT_FOUND');
    }
    return withStore(enriched, product.storeId);
  }
  assertOwnerOrLocationAccess(user, product.storeId.toString(), product.locationId.toString());
  if (!enriched) throw ApiError.notFound('Instamart product not found', 'INSTAMART_PRODUCT_NOT_FOUND');
  return withStore(enriched, product.storeId);
}

// A store may only edit its own store-specific fields (price/discount/
// sku/status/sortOrder) — categoryId/subcategoryId/productId are inherited
// from the global product and are not independently editable here.
export async function updateInstamartProduct(id: string, data: Record<string, unknown>, user: JwtPayload) {
  const product = await findProductOrThrow(id);
  assertOwnerOrLocationAccess(user, product.storeId.toString(), product.locationId.toString());

  delete data.storeId;
  delete data.locationId;
  delete data.productId;
  delete data.categoryId;
  delete data.subcategoryId;
  Object.assign(product, data);
  await product.save();
  return product;
}

export async function deleteInstamartProduct(id: string, user: JwtPayload) {
  const product = await findProductOrThrow(id);
  assertOwnerOrLocationAccess(user, product.storeId.toString(), product.locationId.toString());

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Inventory.deleteMany({ productId: id }, { session });
      await InstamartVariant.deleteMany({ productId: id }, { session });
      await product.deleteOne({ session });
    });
  } finally {
    await session.endSession();
  }
}

export async function updateInstamartProductStatus(id: string, status: string, user: JwtPayload) {
  return updateInstamartProduct(id, { status }, user);
}

// --- Variants ---
// A variant (e.g. "500g", "1kg", "250ml") is purely a name + mrp/sellingPrice on top of
// the store's own listing — it shares the listing's own stock/inventory rather than
// tracking its own (see README for the trade-off); once a listing has any
// ACTIVE variant, ordering requires picking one (enforced in order.service.ts).

export async function listInstamartVariants(productId: string, user: JwtPayload) {
  const product = await findProductOrThrow(productId);
  assertOwnerOrLocationAccess(user, product.storeId.toString(), product.locationId.toString());
  return InstamartVariant.find({ productId }).sort({ isDefault: -1, name: 1 });
}

export async function createInstamartVariant(productId: string, data: Record<string, unknown>, user: JwtPayload) {
  const product = await findProductOrThrow(productId);
  assertOwnerOrLocationAccess(user, product.storeId.toString(), product.locationId.toString());
  return InstamartVariant.create({ ...data, productId });
}

export async function updateInstamartVariant(
  productId: string,
  variantId: string,
  data: Record<string, unknown>,
  user: JwtPayload,
) {
  const product = await findProductOrThrow(productId);
  assertOwnerOrLocationAccess(user, product.storeId.toString(), product.locationId.toString());

  const variant = await InstamartVariant.findOneAndUpdate({ _id: variantId, productId }, data, { new: true });
  if (!variant) throw ApiError.notFound('Instamart variant not found', 'INSTAMART_VARIANT_NOT_FOUND');
  return variant;
}

export async function deleteInstamartVariant(productId: string, variantId: string, user: JwtPayload) {
  const product = await findProductOrThrow(productId);
  assertOwnerOrLocationAccess(user, product.storeId.toString(), product.locationId.toString());

  const variant = await InstamartVariant.findOneAndDelete({ _id: variantId, productId });
  if (!variant) throw ApiError.notFound('Instamart variant not found', 'INSTAMART_VARIANT_NOT_FOUND');
}
