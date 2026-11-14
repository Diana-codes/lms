import { addDays, addMonths, daysBetween, type IsoDate } from '../dates';
import type { Frequency } from './terms';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number): IsoDate => `${y}-${pad(m)}-${pad(d)}`;

/** Day of the week, 0 = Sunday … 6 = Saturday. */
export function weekday(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Easter Sunday (Gregorian), by the anonymous Gregorian algorithm. */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

/**
 * Rwanda's public holidays that can be computed: the fixed dates, Good
 * Friday, Easter Monday and Umuganura (first Friday of August). Eid al-Fitr
 * and Eid al-Adha follow the moon and are announced each year; lenders add
 * them as extra holidays.
 */
export function rwandaHolidays(year: number): IsoDate[] {
  const fixed: Array<[number, number]> = [
    [1, 1], // New Year
    [1, 2], // Day after New Year
    [2, 1], // National Heroes' Day
    [4, 7], // Genocide against the Tutsi Memorial Day
    [5, 1], // Labour Day
    [7, 1], // Independence Day
    [7, 4], // Liberation Day
    [8, 15], // Assumption
    [12, 25], // Christmas
    [12, 26], // Boxing Day
  ];
  const easter = easterSunday(year);
  let umuganura = iso(year, 8, 1);
  while (weekday(umuganura) !== 5) umuganura = addDays(umuganura, 1);
  return [
    ...fixed.map(([m, d]) => iso(year, m, d)),
    addDays(easter, -2),
    addDays(easter, 1),
    umuganura,
  ].sort();
}

export function isNonWorkingDay(date: IsoDate, extraHolidays: ReadonlySet<IsoDate>): boolean {
  const day = weekday(date);
  if (day === 0 || day === 6) return true;
  if (extraHolidays.has(date)) return true;
  return rwandaHolidays(Number(date.slice(0, 4))).includes(date);
}

/** The date itself, or the next working day after it. */
export function nextWorkingDay(
  date: IsoDate,
  extraHolidays: ReadonlySet<IsoDate> = new Set(),
): IsoDate {
  let d = date;
  for (let i = 0; i < 14 && isNonWorkingDay(d, extraHolidays); i++) d = addDays(d, 1);
  return d;
}

export interface DueDateOptions {
  disbursedOn: IsoDate;
  frequency: Frequency;
  count: number;
  /** Monthly only: the fixed day of the month. */
  dueDayOfMonth: number | null;
  moveOffNonWorkingDays: boolean;
  extraHolidays?: ReadonlySet<IsoDate>;
}

/** The shortest first period when instalments fall on a fixed day of the month. */
export const MIN_FIRST_PERIOD_DAYS = 15;

/**
 * Due dates for a schedule. Periods are counted from the nominal dates
 * (before moving off weekends and holidays), so moving one date never
 * shifts the rest.
 */
export function dueDates(opts: DueDateOptions): { nominal: IsoDate[]; actual: IsoDate[] } {
  const nominal: IsoDate[] = [];
  if (opts.frequency === 'MONTHLY') {
    let first: IsoDate;
    if (opts.dueDayOfMonth != null) {
      const [y, m] = opts.disbursedOn.split('-').map(Number) as [number, number];
      first = iso(y, m, opts.dueDayOfMonth);
      while (daysBetween(opts.disbursedOn, first) < MIN_FIRST_PERIOD_DAYS) {
        first = addMonths(first, 1);
      }
    } else {
      first = addMonths(opts.disbursedOn, 1);
    }
    // Dates come from the original day each time, so 31 Jan → 28 Feb → 31 Mar.
    const anchor = opts.dueDayOfMonth != null ? first : opts.disbursedOn;
    const offset = opts.dueDayOfMonth != null ? 0 : 1;
    for (let k = 0; k < opts.count; k++) nominal.push(addMonths(anchor, k + offset));
  } else {
    const step = opts.frequency === 'WEEKLY' ? 7 : 14;
    for (let k = 1; k <= opts.count; k++) nominal.push(addDays(opts.disbursedOn, step * k));
  }
  const extra = opts.extraHolidays ?? new Set<IsoDate>();
  const actual = opts.moveOffNonWorkingDays
    ? nominal.map((d) => nextWorkingDay(d, extra))
    : nominal.slice();
  return { nominal, actual };
}
