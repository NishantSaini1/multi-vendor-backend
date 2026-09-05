import { ActivityLog } from '../models/ActivityLog';
import { PaginationParams } from '../utils/pagination';
import { JwtPayload } from '../utils/jwt';
import { UserType } from '../constants/roles';
import { logger } from '../utils/logger';

interface LogActivityInput {
  action: string;
  module: string;
  entityType: string;
  entityId?: string;
  locationId?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

// Fire-and-forget, like notification.service.notify(): an audit-log write
// must never be the reason a real admin action fails, so this never throws
// — a logging failure is itself logged (to the app logger, not the audit
// trail) and otherwise swallowed. Instrumented at the highest-stakes admin
// mutations first (admin-user management, since that's this phase's own
// module) rather than retrofitted across every existing admin endpoint —
// broader coverage is a natural, separate follow-up (see README).
export async function logActivity(user: JwtPayload, input: LogActivityInput): Promise<void> {
  try {
    await ActivityLog.create({
      userId: user.userId,
      userType: user.userType as UserType,
      action: input.action,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      locationId: input.locationId,
      oldData: input.oldData,
      newData: input.newData,
      ip: input.ip,
      userAgent: input.userAgent,
    });
  } catch (err) {
    logger.error({ err, action: input.action, module: input.module }, 'Failed to write activity log entry');
  }
}

export async function listActivityLogs(filter: Record<string, unknown>, pagination: PaginationParams) {
  const [items, total] = await Promise.all([
    ActivityLog.find(filter).sort(pagination.sort).skip(pagination.skip).limit(pagination.limit),
    ActivityLog.countDocuments(filter),
  ]);
  return { items, total };
}
