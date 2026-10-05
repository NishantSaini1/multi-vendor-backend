import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { VendorFoodItem } from '../models/VendorFoodItem';
import { InstamartProduct } from '../models/InstamartProduct';
import { InstamartGlobalProduct } from '../models/InstamartGlobalProduct';
import { PRICING_MODELS } from '../constants/enums';
import { logger } from './logger';

// Brings existing products onto the current pricing model (see
// pricing.service.ts): every product carries a Platform Selling Price (what the
// customer pays, in its price field) next to its Vendor Original Price, and
// MARKUP is a per-product markupPercent.
//
// Before, a MARKUP product stored the VENDOR's price in the price field and the
// customer price was derived from a seller-level markup (or a hand-fixed
// platform price); a COMMISSION product stored the single price customers pay.
//
//   MARKUP seller, a product without vendorOriginalPrice (the older shape):
//     vendorOriginalPrice = the stored price
//     markupPercent       = its own markupPercent, else the hand-fixed platform
//                           price's %, else the seller's old default markup
//                           (a flat amount becomes its % of the price)
//     price               = vendorOriginalPrice + markup  (what customers pay)
//   COMMISSION seller, a product without vendorOriginalPrice:
//     vendorOriginalPrice = the stored price (informational), price unchanged
//   every product: platformSellingPrice mirrors price; markupAmount is derived.
//
// Then drops the retired fields (seller markupType/markupValue, product
// platformPriceManual). Orders already placed are untouched — their pricing is
// snapshotted. Idempotent. Products whose selling price is above the printed MRP
// are listed (not changed) so they can be fixed — saving them is now refused.
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
}

// The markup % an older MARKUP product stands for, given its stored (vendor) price.
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

export async function migrateProductMarkup(dryRun = false) {
  let sellers = 0;
  let products = 0;
  const aboveMrp: { seller: string; product: string; sellingPrice: number; mrp: number }[] = [];

  const targets = [
    { label: 'vendor', seller: Vendor, product: VendorFoodItem, sellerKey: 'vendorId', priceKey: 'price' },
    { label: 'store', seller: Store, product: InstamartProduct, sellerKey: 'storeId', priceKey: 'sellingPrice' },
  ] as const;

  for (const t of targets) {
    // Raw collections: markupType/markupValue are no longer in the schemas.
    const sellerDocs = (await t.seller.collection.find({}).toArray()) as unknown as SellerDoc[];
    for (const seller of sellerDocs) {
      sellers += 1;
      const isMarkup = seller.pricingModel === PRICING_MODELS.MARKUP;
      const productDocs = (await t.product.collection.find({ [t.sellerKey]: seller._id }).toArray()) as unknown as ProductDoc[];

      for (const product of productDocs) {
        const stored = (product as unknown as Record<string, unknown>)[t.priceKey] as number;
        if (typeof stored !== 'number') continue;
        const legacy = product.vendorOriginalPrice === undefined;

        let sellingPrice = stored;
        let vendorOriginalPrice = product.vendorOriginalPrice ?? stored;
        let markupPercent = isMarkup ? product.markupPercent ?? 0 : product.markupPercent ?? 0;
        if (isMarkup) {
          if (legacy) {
            markupPercent = legacyPercent(seller, product, stored);
            vendorOriginalPrice = stored;
          }
          sellingPrice = markupPercent > 0 ? round2(vendorOriginalPrice * (1 + markupPercent / 100)) : vendorOriginalPrice;
        }
        const markupAmount = isMarkup ? round2(sellingPrice - vendorOriginalPrice) : 0;

        // The printed MRP: on the product itself (Food) or its shared catalog entry (Instamart).
        let mrp = product.mrp;
        if (mrp === undefined && product.productId) {
          mrp = ((await InstamartGlobalProduct.collection.findOne({ _id: product.productId as never })) as { mrp?: number } | null)?.mrp;
        }
        if (typeof mrp === 'number' && mrp > 0 && sellingPrice > mrp + 0.005) {
          aboveMrp.push({ seller: String(seller._id), product: String(product._id), sellingPrice, mrp });
        }

        products += 1;
        if (dryRun) continue;
        await t.product.collection.updateOne(
          { _id: product._id as never },
          {
            $set: { [t.priceKey]: sellingPrice, platformSellingPrice: sellingPrice, vendorOriginalPrice, markupPercent, markupAmount },
            $unset: { platformPriceManual: '' },
          },
        );
      }

      if (!dryRun && (seller.markupType !== undefined || seller.markupValue !== undefined)) {
        await t.seller.collection.updateOne({ _id: seller._id as never }, { $unset: { markupType: '', markupValue: '' } });
      }
      logger.info(`${t.label} ${String(seller._id)}: ${productDocs.length} products ${isMarkup ? '(MARKUP)' : '(COMMISSION)'}`);
    }
  }

  logger.info(`${dryRun ? '[dry run] would migrate' : 'Migrated'} ${products} products across ${sellers} sellers`);
  if (aboveMrp.length > 0) {
    logger.warn(
      `${aboveMrp.length} product(s) have a selling price above their MRP — fix these (lower the price or the markup): ${JSON.stringify(aboveMrp.slice(0, 50))}`,
    );
  }
  return { sellers, products, aboveMrp };
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
