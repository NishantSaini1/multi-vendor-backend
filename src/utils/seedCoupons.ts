import { Coupon } from '../models/Coupon';
import { logger } from './logger';

// Starter customer offers. Platform-wide (no location/vendor/store scoping)
// so they show up in every city until an admin narrows them. Insert-only:
// a code that already exists is left exactly as the admin last edited it.
const STARTER_COUPONS = [
  {
    code: 'WELCOME50',
    discountType: 'PERCENTAGE',
    discountValue: 50,
    maximumDiscount: 100,
    minimumOrder: 149,
    perUserLimit: 1,
    firstOrderOnly: true,
    businessTypes: [],
  },
  {
    code: 'FEAST100',
    discountType: 'FIXED',
    discountValue: 100,
    minimumOrder: 499,
    perUserLimit: 3,
    businessTypes: ['FOOD'],
  },
  {
    code: 'TASTY20',
    discountType: 'PERCENTAGE',
    discountValue: 20,
    maximumDiscount: 60,
    minimumOrder: 199,
    perUserLimit: 5,
    businessTypes: ['FOOD'],
  },
  {
    code: 'FRESH15',
    discountType: 'PERCENTAGE',
    discountValue: 15,
    maximumDiscount: 75,
    minimumOrder: 249,
    perUserLimit: 5,
    businessTypes: ['INSTAMART'],
  },
  {
    code: 'SAVE40',
    discountType: 'FIXED',
    discountValue: 40,
    minimumOrder: 299,
    perUserLimit: 10,
    businessTypes: [],
  },
];

export async function seedCoupons() {
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setFullYear(endDate.getFullYear() + 1);

  let created = 0;
  for (const data of STARTER_COUPONS) {
    const exists = await Coupon.exists({ code: data.code });
    if (exists) continue;
    await Coupon.create({
      ...data,
      locationIds: [],
      vendorIds: [],
      storeIds: [],
      categoryIds: [],
      foodItemIds: [],
      usedCount: 0,
      status: 'ACTIVE',
      startDate,
      endDate,
    });
    created += 1;
  }
  logger.info(`Coupons: ${created} created, ${STARTER_COUPONS.length - created} already existed`);
}

// `npm run seed:coupons` — coupons only, without re-running the full seed.
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connectDatabase, disconnectDatabase } = require('../config/database');
  (async () => {
    await connectDatabase();
    await seedCoupons();
    await disconnectDatabase();
    process.exit(0);
  })().catch((err) => {
    logger.error({ err }, 'Coupon seed failed');
    process.exit(1);
  });
}
