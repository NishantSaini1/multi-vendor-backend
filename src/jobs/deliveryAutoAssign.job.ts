import { runDeliveryAutoAssignSweep } from '../services/delivery.service';
import { logger } from '../utils/logger';

// Retries auto-assignment for READY_FOR_PICKUP orders nobody was free for
// earlier, and moves on from auto-assigned partners who never answered —
// see delivery.service.ts's runDeliveryAutoAssignSweep.
export async function runDeliveryAutoAssign(): Promise<{ timedOut: number; assigned: number }> {
  const result = await runDeliveryAutoAssignSweep();
  if (result.timedOut > 0 || result.assigned > 0) {
    logger.info(result, 'Delivery auto-assign sweep completed');
  }
  return result;
}
