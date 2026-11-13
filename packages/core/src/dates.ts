/**
 * Calendar dates as "YYYY-MM-DD" strings. Due dates are calendar days in
 * Rwanda (UTC+2, no daylight saving), so we avoid Date objects with a time
 * zone attached wherever a day is all we mean.
 */
export type IsoDate = string;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Africa/Kigali is UTC+2 all year. */
export const KIGALI_OFFSET_MINUTES = 120;

function parts(date: IsoDate): [number, number, number] {
  const m = ISO.exec(date);
  if (!m) throw new RangeError(`Not an ISO date: "${date}"`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`Not a real calendar date: "${date}"`);
  }
  return [y, mo, d];
}

function build(y: number, m: number, d: number): IsoDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isIsoDate(value: string): boolean {
  try {
    parts(value);
    return true;
  } catch {
    return false;
  }
}

/** Add calendar months, clamping to the month's last day (31 Jan + 1 = 28/29 Feb). */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const [y, m, d] = parts(date);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return build(ny, nm, Math.min(d, last));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return build(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** The calendar day in Kigali for an instant. */
export function kigaliDate(instant: Date = new Date()): IsoDate {
  const t = new Date(instant.getTime() + KIGALI_OFFSET_MINUTES * 60_000);
  return build(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** A Date at UTC midnight, the form Prisma expects for DATE columns. */
export function isoToUtcDate(date: IsoDate): Date {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d));
}

export function utcDateToIso(date: Date): IsoDate {
  return build(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** "2026-05-04" -> "4 May 2026" (or "4 May" with `year: false`), as in the designs. */
export function formatDate(date: IsoDate, opts: { year?: boolean } = {}): string {
  const [y, m, d] = parts(date);
  const base = `${d} ${MONTHS[m - 1]}`;
  return opts.year === false ? base : `${base} ${y}`;
}

/** "2026-05-04" -> "May 2026". */
export function formatMonthYear(date: IsoDate): string {
  const [y, m] = parts(date);
  return `${MONTHS[m - 1]} ${y}`;
}
