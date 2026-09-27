import { Review } from '../models/Review';
import { logger } from './logger';

// Reviews were originally keyed by { user, product, order } with a UNIQUE
// index on those three fields. The current schema uses customerId / orderId /
// targetType / targetId instead, so new reviews never set user/product/order
// — MongoDB indexes the missing fields as null, and after the first
// new-style review every later one collided on (null, null, null) with a
// 409 "Duplicate value for user, product, order".
//
// Dropping that obsolete index only removes the constraint; no review data
// is touched. Idempotent: does nothing if the index is already gone.
// (Duplicate protection for current reviews is enforced in
// review.service.createReview's REVIEW_ALREADY_EXISTS check.)
const LEGACY_UNIQUE_INDEXES = ['user_1_product_1_order_1'];

export async function dropLegacyReviewIndexes(): Promise<string[]> {
  const existing = await Review.collection.indexes();
  const dropped: string[] = [];
  for (const name of LEGACY_UNIQUE_INDEXES) {
    if (existing.some((i) => i.name === name)) {
      await Review.collection.dropIndex(name);
      dropped.push(name);
    }
  }
  logger.info(dropped.length ? `Dropped legacy review index(es): ${dropped.join(', ')}` : 'No legacy review indexes to drop');
  return dropped;
}

// `npm run fix:review-indexes`
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connectDatabase, disconnectDatabase } = require('../config/database');
  (async () => {
    await connectDatabase();
    await dropLegacyReviewIndexes();
    await disconnectDatabase();
    process.exit(0);
  })().catch((err) => {
    logger.error({ err }, 'Review index fix failed');
    process.exit(1);
  });
}
