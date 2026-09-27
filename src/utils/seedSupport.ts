import { SupportFaq } from '../models/SupportFaq';
import { logger } from './logger';

// Starter help articles for the app's Help & Support screen. Insert-only by
// question text: anything an admin has since edited or deleted stays as is.
const STARTER_FAQS = [
  { category: 'ORDER', displayOrder: 1, question: 'Where is my order?', answer: 'Open Orders and tap your order, then "Track order" to see its live status, the rider on the way and the estimated arrival time.' },
  { category: 'ORDER', displayOrder: 2, question: 'Can I cancel my order?', answer: 'You can cancel from the order details screen until the restaurant or store starts preparing it. After that, please raise a request here and our team will help.' },
  { category: 'PAYMENT', displayOrder: 3, question: 'Money was deducted but the order failed', answer: 'Failed payments are usually reversed automatically by your bank within 5–7 working days. If it has been longer, raise a Payment issue with the order selected and we will check it for you.' },
  { category: 'REFUND', displayOrder: 4, question: 'How long do refunds take?', answer: 'Refunds to your wallet are instant. Refunds to UPI, cards or net banking take 5–7 working days depending on your bank.' },
  { category: 'MISSING_ITEM', displayOrder: 5, question: 'An item was missing from my order', answer: 'Sorry about that! Raise a Missing item request, choose the order and add a photo of what you received. We will arrange a refund or replacement.' },
  { category: 'DELIVERY', displayOrder: 6, question: 'My order is late', answer: 'Delivery times can stretch during peak hours or bad weather. Track the order for the latest estimate; if it is well past the promised time, contact us and we will follow up with the rider.' },
  { category: 'ACCOUNT', displayOrder: 7, question: 'How do I change my phone number?', answer: 'Go to Account → Edit profile → Change phone. We will send an OTP to the new number to confirm it.' },
  { category: 'OTHER', displayOrder: 8, question: 'How do coupons work?', answer: 'Apply a coupon on the cart or checkout screen. You will see the exact saving before you pay; each coupon has its own minimum order and validity shown in its details.' },
];

export async function seedSupport() {
  let created = 0;
  for (const faq of STARTER_FAQS) {
    const exists = await SupportFaq.exists({ question: faq.question });
    if (exists) continue;
    await SupportFaq.create({ ...faq, status: 'ACTIVE' });
    created += 1;
  }
  logger.info(`Support FAQs: ${created} created, ${STARTER_FAQS.length - created} already existed`);
}

// `npm run seed:support` — FAQs only, without re-running the full seed.
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { connectDatabase, disconnectDatabase } = require('../config/database');
  (async () => {
    await connectDatabase();
    await seedSupport();
    await disconnectDatabase();
    process.exit(0);
  })().catch((err) => {
    logger.error({ err }, 'Support seed failed');
    process.exit(1);
  });
}
