import { Vendor } from '../models/Vendor';
import { Store } from '../models/Store';
import { VendorFoodItem } from '../models/VendorFoodItem';
import { InstamartProduct } from '../models/InstamartProduct';
import { PRICING_MODELS } from '../constants/enums';
import { logger } from './logger';

// Markup used to be one default % (or flat amount) per vendor/store, with an
// optional hand-fixed platform price per product. It is now a markup % on each
// PRODUCT (see pricing.service.ts). This converts existing data:
//
//   MARKUP sellers, per product:
//     hand-fixed platform price  -> markupPercent = (platform - price) / price × 100
//     else seller PERCENTAGE     -> markupPercent = the seller's old value
//     else seller FIXED amount   -> markupPercent = amount / price × 100
//   every product                -> platformSellingPrice / markupAmount re-derived
//   COMMISSION sellers' products -> markupPercent 0, platform price = own price
//
// then drops the retired fields (seller markupType/markupValue, product
// platformPriceManual). Orders already placed are untouched — their pricing is
// snapshotted. Idempotent: running it again changes nothing.
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
  price?: number;
  sellingPrice?: number;
  platformSellingPrice?: number;
  platformPriceManual?: boolean;
  markupPercent?: number;
}

function legacyPercent(seller: SellerDoc, product: ProductDoc, price: number): number {
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
        const price = (product as unknown as Record<string, unknown>)[t.priceKey] as number;
        if (typeof price !== 'number') continue;
        // Don't overwrite a percent that has already been set on the new model.
        const percent = isMarkup ? (product.markupPercent && product.markupPercent > 0 ? product.markupPercent : legacyPercent(seller, product, price)) : 0;
        const platformSellingPrice = percent > 0 ? round2(price * (1 + percent / 100)) : price;
        const markupAmount = round2(platformSellingPrice - price);
        products += 1;
        if (dryRun) continue;
        await t.product.collection.updateOne(
          { _id: product._id as never },
          { $set: { markupPercent: percent, platformSellingPrice, markupAmount }, $unset: { platformPriceManual: '' } },
        );
      }

      if (!dryRun && (seller.markupType !== undefined || seller.markupValue !== undefined)) {
        await t.seller.collection.updateOne({ _id: seller._id as never }, { $unset: { markupType: '', markupValue: '' } });
      }
      logger.info(`${t.label} ${String(seller._id)}: ${productDocs.length} products ${isMarkup ? '(MARKUP)' : '(COMMISSION)'}`);
    }
  }

  logger.info(`${dryRun ? '[dry run] would migrate' : 'Migrated'} ${products} products across ${sellers} sellers`);
  return { sellers, products };
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
