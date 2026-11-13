/**
 * Money helpers. RWF has no minor unit, so every amount is a whole number of
 * francs held in a bigint. Nothing in here accepts or returns a float amount.
 */
export type Rwf = bigint;

const GROUP = /\B(?=(\d{3})+(?!\d))/g;

function group(digits: string): string {
  return digits.replace(GROUP, ',');
}

/** 4500000n -> "RWF 4,500,000". Pass `symbol: false` for table cells. */
export function formatRwf(amount: Rwf, opts: { symbol?: boolean } = {}): string {
  const negative = amount < 0n;
  const body = group((negative ? -amount : amount).toString());
  const text = (negative ? '−' : '') + body;
  return opts.symbol === false ? text : `RWF ${text}`;
}

const UNITS: Array<[bigint, string]> = [
  [1_000_000_000n, 'B'],
  [1_000_000n, 'M'],
  [1_000n, 'K'],
];

/**
 * Short form for headline figures: 2_480_000_000n -> "RWF 2.48B",
 * 318_000_000n -> "RWF 318M", 14_200_000n -> "RWF 14.2M", 850_000n -> "RWF 850K".
 * Keeps three significant digits and rounds half up. Display only.
 */
export function formatRwfCompact(amount: Rwf, opts: { symbol?: boolean } = {}): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  let text = group(abs.toString());
  for (const [unit, suffix] of UNITS) {
    if (abs < unit) continue;
    const whole = abs / unit;
    const decimals = whole >= 100n ? 0 : whole >= 10n ? 1 : 2;
    const factor = 10n ** BigInt(decimals);
    const scaled = (abs * factor + unit / 2n) / unit;
    const intPart = scaled / factor;
    const fracPart = scaled % factor;
    let frac = decimals ? fracPart.toString().padStart(decimals, '0').replace(/0+$/, '') : '';
    if (frac) frac = '.' + frac;
    text = `${group(intPart.toString())}${frac}${suffix}`;
    break;
  }
  const signed = (negative ? '−' : '') + text;
  return opts.symbol === false ? signed : `RWF ${signed}`;
}

/**
 * Parse user or wire input into whole francs. Accepts "4500000", "4,500,000"
 * and "RWF 4,500,000". Rejects decimals, negatives and anything else.
 */
export function parseRwf(input: string): Rwf {
  const cleaned = input
    .trim()
    .replace(/^RWF\s*/i, '')
    .replace(/[,\s]/g, '');
  if (!/^\d+$/.test(cleaned)) {
    throw new RangeError(`Not a whole RWF amount: "${input}"`);
  }
  return BigInt(cleaned);
}

/** Convert a JS number that is already a whole, safe integer. */
export function toRwf(value: number): Rwf {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Not a safe whole RWF amount: ${value}`);
  }
  return BigInt(value);
}

/** Integer division, rounding half up. Both arguments must be non-negative. */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('Denominator must be positive');
  if (numerator < 0n) throw new RangeError('Numerator must be non-negative');
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export const BPS = 10_000n;

/** amount × basis points, rounded half up. 3,500 bps of 1,000,000 = 350,000. */
export function applyBps(amount: Rwf, bps: number): Rwf {
  assertBps(bps);
  return divRoundHalfUp(amount * BigInt(bps), BPS);
}

/** part ÷ whole as basis points, rounded half up. Returns 0 when whole is 0. */
export function ratioBps(part: Rwf, whole: Rwf): number {
  if (whole === 0n) return 0;
  return Number(divRoundHalfUp(part * BPS, whole));
}

/** 310 -> "3.1%", 9640 -> "96.4%". */
export function formatBps(bps: number, decimals = 1): string {
  return `${(bps / 100).toFixed(decimals)}%`;
}

export function assertBps(bps: number): void {
  if (!Number.isInteger(bps) || bps < 0) {
    throw new RangeError(`Rate must be a whole, non-negative number of basis points: ${bps}`);
  }
}

export function sumRwf(amounts: Iterable<Rwf>): Rwf {
  let total = 0n;
  for (const a of amounts) total += a;
  return total;
}
