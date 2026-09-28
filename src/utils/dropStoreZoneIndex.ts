import { Store } from '../models/Store';
import { logger } from './logger';

// The "one store per type per zone" unique multikey index was removed in favour
// of allowing multiple stores/vendors of the same type to exist in the same
// delivery zone. This script drops the now-absent index from the live database
// so Mongoose no longer errors on startup about a stale constraint.
//
// Idempotent: does nothing if the index is already gone.
const INDEX_NAME = 'deliveryZoneId_1_storeTypeIds_1';

export async function dropStoreZoneIndex(): Promise<void> {
  const existing = await Store.collection.indexes();
  if (!existing.some((i) => i.name === INDEX_NAME)) {
    logger.info('Store zone-type unique index already absent — nothing to drop');
    return;
  }
  await Store.collection.dropIndex(INDEX_NAME);
  logger.info(`Dropped store zone-type unique index: ${INDEX_NAME}`);
}

// `npm run drop:store-zone-index`
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connectDatabase, disconnectDatabase } = require('../config/database');
  (async () => {
    await connectDatabase();
    await dropStoreZoneIndex();
    await disconnectDatabase();
    process.exit(0);
  })().catch((err) => {
    logger.error({ err }, 'Store zone index drop failed');
    process.exit(1);
  });
}
