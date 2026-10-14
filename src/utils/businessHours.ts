import { DAYS_OF_WEEK } from '../constants/enums';

// Opening-hours maths shared by the vendor auto open/close job and the store
// "closed right now" check at order time. All times are the wall-clock time of the
// seller's own location (Location.timezone), never the server's.

const DAY_ORDER = [
  DAYS_OF_WEEK.SUNDAY,
  DAYS_OF_WEEK.MONDAY,
  DAYS_OF_WEEK.TUESDAY,
  DAYS_OF_WEEK.WEDNESDAY,
  DAYS_OF_WEEK.THURSDAY,
  DAYS_OF_WEEK.FRIDAY,
  DAYS_OF_WEEK.SATURDAY,
] as string[];

export interface LocalTime {
  day: string; // a DAYS_OF_WEEK value
  yesterday: string;
  minutes: number; // minutes since local midnight
  dateKey: string; // local YYYY-MM-DD
}

export interface ScheduleDay {
  day: string;
  openTime?: string | null;
  closeTime?: string | null;
  isClosed?: boolean;
}

export interface Schedule {
  weeklySchedule: ScheduleDay[];
  holidays?: (Date | string)[];
}

// "HH:mm" → minutes since midnight; null when it isn't a valid time.
export function parseHHmm(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 24 && min < 60 ? h * 60 + min : null;
}

// The wall-clock time at `at` in the IANA timezone `timeZone`.
export function localTimeIn(timeZone: string | undefined, at: Date = new Date()): LocalTime {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || 'Asia/Kolkata',
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  } catch {
    return localTimeIn('Asia/Kolkata', at); // unknown timezone name
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = get('weekday').toUpperCase();
  const idx = DAY_ORDER.indexOf(day);
  return {
    day,
    yesterday: DAY_ORDER[(idx + 6) % 7],
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

// Is `minutes` inside a daily open/close window? Handles overnight windows
// (18:00–02:00). Equal or unparseable times mean "no restriction" → open.
export function isWithinWindow(open: string | null | undefined, close: string | null | undefined, minutes: number): boolean {
  const o = parseHHmm(open);
  const c = parseHHmm(close);
  if (o === null || c === null || o === c) return true;
  return o < c ? minutes >= o && minutes < c : minutes >= o || minutes < c;
}

// Should a vendor with this weekly schedule be open at `local`?
//  - a closed day / a holiday / a day with no entry → closed
//  - an overnight window opened yesterday is still open until its close time today
export function isScheduledOpen(schedule: Schedule, local: LocalTime): boolean {
  const entry = (day: string) => schedule.weeklySchedule.find((d) => d.day === day);
  const holiday = (schedule.holidays ?? []).some((h) => {
    const key = h instanceof Date ? h.toISOString().slice(0, 10) : String(h).slice(0, 10);
    return key === local.dateKey;
  });

  const today = entry(local.day);
  if (!holiday && today && !today.isClosed) {
    const o = parseHHmm(today.openTime);
    const c = parseHHmm(today.closeTime);
    if (o === null || c === null || o === c) return true; // listed open with no usable times: all day
    if (o < c ? local.minutes >= o && local.minutes < c : local.minutes >= o) return true;
  }

  // tail of yesterday's overnight window
  const prev = entry(local.yesterday);
  if (prev && !prev.isClosed) {
    const o = parseHHmm(prev.openTime);
    const c = parseHHmm(prev.closeTime);
    if (o !== null && c !== null && o > c && local.minutes < c) return true;
  }
  return false;
}
