import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { VendorFoodItem } from '../models/VendorFoodItem';
import { InstamartProduct } from '../models/InstamartProduct';
import { InstamartGlobalProduct } from '../models/InstamartGlobalProduct';
import { FoodVariant } from '../models/FoodVariant';
import { InstamartVariant } from '../models/InstamartVariant';
import { ModifierGroup } from '../models/ModifierGroup';
import { ModifierOption } from '../models/ModifierOption';
import { PRICING_MODELS } from '../constants/enums';
import { markupProfitOf } from '../services/pricing.service';
import { logger } from './logger';

// Brings existing products onto the current pricing model (see
// pricing.service.ts): the price a product stores is ALWAYS what the customer
// pays (its Selling Price), and a MARKUP seller's per-product markupPercent is
// just the platform's internal share of it. Earlier versions kept a separate
// Vendor Original Price and derived the customer price from it.
//
// For each product that predates the model (no pricingSchemaVersion):
//
//   MARKUP seller, product with a vendorOriginalPrice (the last shape):
//     the stored price is already the selling price — kept; markupPercent kept.
//     Its variants and add-ons were the VENDOR's prices, marked up at read time —
//     so each is multiplied by (1 + markupPercent / 100) to store what customers
//     actually paid.
//   MARKUP seller, product with no vendorOriginalPrice (the oldest shape):
//     the stored price is the vendor's price. markupPercent = its own, else the
//     hand-fixed platform price's %, else the seller's old default markup (a
//     flat amount becomes its % of the price). The price, variants and add-ons
//     are multiplied by (1 + markupPercent / 100).
//   COMMISSION seller: price, variants and add-ons are left exactly as they are.
//
// then markupAmount is re-derived, vendorOriginalPrice / platformSellingPrice /
// platformPriceManual are dropped, the product is marked pricingSchemaVersion 2
// and the retired seller fields (markupType / markupValue) are removed. Customer
// prices therefore do not change. Orders already placed are untouched — their
// pricing is snapshotted. Idempotent. Products whose selling price is above the
// printed MRP are listed (not changed) so they can be fixed.
//
// Run it right after deploying — until then a MARKUP product's variants and
// add-ons are charged at the vendor's price.
//
//   npm run migrate:product-markup            apply
//   npm run migrate:product-markup -- --dry-run   report only

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

interface SellerDoc {
  _id: unknown;
  pricingModel?: string;
  markupType?: string;
  markupValue?: number;
}

interface ProductDoc {
  _id: unknown;
  productId?: unknown;
  price?: number;
  sellingPrice?: number;
  mrp?: number;
  vendorOriginalPrice?: number;
  platformSellingPrice?: number;
  platformPriceManual?: boolean;
  markupPercent?: number;
  pricingSchemaVersion?: number;
}

// The markup % an oldest-shape MARKUP product stands for, given its stored (vendor) price.
function legacyPercent(seller: SellerDoc, product: ProductDoc, price: number): number {
  if (product.markupPercent && product.markupPercent > 0) return product.markupPercent;
  if (product.platformPriceManual && typeof product.platformSellingPrice === 'number' && product.platformSellingPrice > price && price > 0) {
    return round2(((product.platformSellingPrice - price) / price) * 100);
  }
  const value = seller.markupValue ?? 0;
  if (!(value > 0)) return 0;
  if (seller.markupType === 'FIXED') return price > 0 ? round2((value / price) * 100) : 0;
  return value;
}

const markUp = (price: number, percent: number) => round2(price * (1 + percent / 100));

export async function migrateProductMarkup(dryRun = false) {
  let sellers = 0;
  let products = 0;
  let variantsAndAddOns = 0;
  const aboveMrp: { seller: string; product: string; sellingPrice: number; mrp: number }[] = [];

  const targets = [
    { label: 'vendor', seller: Vendor, product: VendorFoodItem, sellerKey: 'vendorId', priceKey: 'price', food: true },
    { label: 'store', seller: Store, product: InstamartProduct, sellerKey: 'storeId', priceKey: 'sellingPrice', food: false },
  ] as const;

  // Variants / add-ons of a product, scaled to the selling prices customers pay.
  async function markUpVariants(food: boolean, productId: unknown, percent: number): Promise<number> {
    if (!(percent > 0)) return 0;
    let n = 0;
    if (food) {
      const variants = await FoodVariant.collection.find({ vendorFoodItemId: productId as never }).toArray();
      for (const v of variants) {
        n += 1;
        if (!dryRun) await FoodVariant.collection.updateOne({ _id: v._id }, { $set: { price: markUp(v.price as number, percent) } });
      }
      const groupIds = (await ModifierGroup.collection.find({ vendorFoodItemId: productId as never }).project({ _id: 1 }).toArray()).map((g) => g._id);
      const options = groupIds.length ? await ModifierOption.collection.find({ modifierGroupId: { $in: groupIds } }).toArray() : [];
      for (const o of options) {
        n += 1;
        if (!dryRun) await ModifierOption.collection.updateOne({ _id: o._id }, { $set: { price: markUp(o.price as number, percent) } });
      }
    } else {
      const variants = await InstamartVariant.collection.find({ productId: productId as never }).toArray();
      for (const v of variants) {
        n += 1;
        if (!dryRun) await InstamartVariant.collection.updateOne({ _id: v._id }, { $set: { sellingPrice: markUp(v.sellingPrice as number, percent) } });
      }
    }
    return n;
  }

  for (const t of targets) {
    // Raw collections: markupType/markupValue and the retired product fields are no longer in the schemas.
    const sellerDocs = (await t.seller.collection.find({}).toArray()) as unknown as SellerDoc[];
    for (const seller of sellerDocs) {
      sellers += 1;
      const isMarkup = seller.pricingModel === PRICING_MODELS.MARKUP;
      const productDocs = (await t.product.collection.find({ [t.sellerKey]: seller._id }).toArray()) as unknown as ProductDoc[];

      for (const product of productDocs) {
        const stored = (product as unknown as Record<string, unknown>)[t.priceKey] as number;
        if (typeof stored !== 'number' || product.pricingSchemaVersion === 2) continue;

        let price = stored;
        let markupPercent = product.markupPercent ?? 0;
        if (isMarkup) {
          if (product.vendorOriginalPrice === undefined) {
            // Oldest shape: the stored price is the vendor's.
            markupPercent = legacyPercent(seller, product, stored);
            price = markUp(stored, markupPercent);
          }
          variantsAndAddOns += await markUpVariants(t.food, product._id, markupPercent);
        }
        const markupAmount = isMarkup ? markupProfitOf(price, markupPercent) : 0;

        // The printed MRP: on the product itself (Food) or its shared catalog entry (Instamart).
        let mrp = product.mrp;
        if (mrp === undefined && product.productId) {
          mrp = ((await InstamartGlobalProduct.collection.findOne({ _id: product.productId as never })) as { mrp?: number } | null)?.mrp;
        }
        if (typeof mrp === 'number' && mrp > 0 && price > mrp + 0.005) {
          aboveMrp.push({ seller: String(seller._id), product: String(product._id), sellingPrice: price, mrp });
        }

        products += 1;
        if (dryRun) continue;
        await t.product.collection.updateOne(
          { _id: product._id as never },
          {
            $set: { [t.priceKey]: price, markupPercent, markupAmount, pricingSchemaVersion: 2 },
            $unset: { vendorOriginalPrice: '', platformSellingPrice: '', platformPriceManual: '' },
          },
        );
      }

      if (!dryRun && (seller.markupType !== undefined || seller.markupValue !== undefined)) {
        await t.seller.collection.updateOne({ _id: seller._id as never }, { $unset: { markupType: '', markupValue: '' } });
      }
      logger.info(`${t.label} ${String(seller._id)}: ${productDocs.length} products ${isMarkup ? '(MARKUP)' : '(COMMISSION)'}`);
    }
  }

  logger.info(
    `${dryRun ? '[dry run] would migrate' : 'Migrated'} ${products} products (${variantsAndAddOns} variants/add-ons re-priced) across ${sellers} sellers`,
  );
  if (aboveMrp.length > 0) {
    logger.warn(`${aboveMrp.length} product(s) have a selling price above their MRP — lower the price: ${JSON.stringify(aboveMrp.slice(0, 50))}`);
  }
  return { sellers, products, variantsAndAddOns, aboveMrp };
}

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connectDatabase, disconnectDatabase } = require('../config/database');
  const dryRun = process.argv.includes('--dry-run');
  (async () => {
    await connectDatabase();
    await migrateProductMarkup(dryRun);
    await disconnectDatabase();
    process.exit(0);
  })().catch((err) => {
    logger.error({ err }, 'Product markup migration failed');
    process.exit(1);
  });
}
