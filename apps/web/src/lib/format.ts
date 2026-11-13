import type { ApplicationCard } from './types';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "2026-11-12" -> "Thursday, 12 November". */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday}, ${d} ${MONTHS[m - 1]}`;
}

/** 1700 -> "17%", 1750 -> "17.5%". */
export function rate(bps: number): string {
  return `${Number((bps / 100).toFixed(2))}%`;
}

export const count = (n: number): string => n.toLocaleString('en-US');

/** "12 months · 18% p.a." */
export const termLine = (c: { termMonths: number; annualRateBps: number }): string =>
  `${c.termMonths} ${c.termMonths === 1 ? 'month' : 'months'} · ${rate(c.annualRateBps)} p.a.`;

/** "12 min ago", "5h ago", "3 days ago". `now` is passed in so server and browser agree. */
export function timeAgo(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** The line at the foot of a pipeline card: a status note, or how long it has waited. */
export function cardAge(card: ApplicationCard, now: number): string {
  if (card.statusNote) return card.statusNote;
  if (card.stage === 'NEW') return timeAgo(card.stageEnteredAt, now);
  const days = Math.floor((now - new Date(card.stageEnteredAt).getTime()) / 86_400_000);
  if (days < 1) return 'Today';
  return `${days} ${days === 1 ? 'day' : 'days'} in stage`;
}

/** "13 Nov 2026 · 09:12" in Kigali time (UTC+2). */
export function dateTime(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 120 * 60_000);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]!.slice(0, 3)} ${t.getUTCFullYear()} · ${hh}:${mm}`;
}

/** Today's date in Kigali, for date inputs. */
export function todayIso(): string {
  return new Date(Date.now() + 120 * 60_000).toISOString().slice(0, 10);
}

/** Group digits as the user types: "4500000" -> "4,500,000". */
export function groupDigits(input: string): string {
  const digits = input.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
