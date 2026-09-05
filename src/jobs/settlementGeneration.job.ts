import { generateSettlements } from '../services/settlement.service';
import { SETTLEMENT_PAYEE_TYPES } from '../models/Settlement';
import { SYSTEM_ACTOR } from '../utils/systemActor';
import { logger } from '../utils/logger';

// Generates yesterday's settlements, across every location, for all three
// payee types. Safe to run daily even after a partial prior failure —
// settlement.service already skips (rather than double-counts) a payee
// whose period overlaps an existing settlement, so re-running this for the
// same day is idempotent per payee.
export async function runDailySettlementGeneration(): Promise<void> {
  const periodEnd = new Date();
  periodEnd.setHours(0, 0, 0, 0);
  const periodStart = new Date(periodEnd);
  periodStart.setDate(periodStart.getDate() - 1);

  for (const payeeType of Object.values(SETTLEMENT_PAYEE_TYPES)) {
    try {
      const result = await generateSettlements(
        { payeeType, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString() },
        SYSTEM_ACTOR,
      );
      logger.info(
        { payeeType, created: result.created.length, skipped: result.skipped.length },
        'Daily settlement generation completed for payee type',
      );
    } catch (err) {
      logger.error({ err, payeeType }, 'Daily settlement generation failed for payee type');
    }
  }
}
