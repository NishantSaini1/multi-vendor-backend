import { Vendor } from '../models/Vendor';
import { Location } from '../models/Location';
import { APPROVAL_STATUS, VENDOR_STATUS } from '../constants/enums';
import { isScheduledOpen, localTimeIn } from '../utils/businessHours';
import { logger } from '../utils/logger';

// Opens and closes restaurants on time, from their weekly business hours.
//
// It acts on TRANSITIONS only: a restaurant is opened/closed in the minute its
// schedule says it should be, not forced into the scheduled state every minute.
// So a manual "close for a while" / "open early" by the vendor is respected until the
// next scheduled opening or closing. A temporary closure with a reopen time is
// honoured too: nothing reopens before `reopensAt`, and once it passes the closure is
// cleared and the restaurant reopens if its hours say it should be open.
export async function runVendorScheduleSync(now: Date = new Date()): Promise<{ opened: number; closed: number }> {
  const vendors = await Vendor.find({
    status: VENDOR_STATUS.ACTIVE,
    approvalStatus: APPROVAL_STATUS.APPROVED,
    'businessHours.weeklySchedule.0': { $exists: true },
  }).select('isOpen temporaryClosure businessHours locationId');
  if (vendors.length === 0) return { opened: 0, closed: 0 };

  const locations = await Location.find({ _id: { $in: [...new Set(vendors.map((v) => String(v.locationId)))] } }).select('timezone');
  const tzByLocation = new Map(locations.map((l) => [String(l._id), l.timezone]));
  const minuteAgo = new Date(now.getTime() - 60_000);

  let opened = 0;
  let closed = 0;
  for (const vendor of vendors) {
    try {
      const schedule = { weeklySchedule: vendor.businessHours!.weeklySchedule, holidays: vendor.businessHours!.holidays };
      const tz = tzByLocation.get(String(vendor.locationId));
      const wantNow = isScheduledOpen(schedule, localTimeIn(tz, now));
      const wantBefore = isScheduledOpen(schedule, localTimeIn(tz, minuteAgo));

      // temporary closure
      const reopensAt = vendor.temporaryClosure?.reopensAt;
      if (reopensAt) {
        if (reopensAt.getTime() > now.getTime()) continue; // still closed on purpose
        await Vendor.updateOne(
          { _id: vendor._id },
          { $set: { temporaryClosure: null, ...(wantNow ? { isOpen: true } : {}) } },
        );
        if (wantNow && !vendor.isOpen) opened += 1;
        continue;
      }

      if (wantNow !== wantBefore && vendor.isOpen !== wantNow) {
        await Vendor.updateOne({ _id: vendor._id }, { $set: { isOpen: wantNow } });
        if (wantNow) opened += 1;
        else closed += 1;
      }
    } catch (err) {
      logger.error({ err, vendorId: vendor.id }, 'Vendor schedule sync failed for a vendor');
    }
  }

  if (opened || closed) logger.info({ opened, closed }, 'Vendor schedule sync applied opening hours');
  return { opened, closed };
}
