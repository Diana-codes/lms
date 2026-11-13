import { formatBps, formatRwfCompact } from '@kora/core';

/** Points for an SVG polyline across a fixed box. */
export function linePoints(
  values: number[],
  width: number,
  height: number,
  lo: number,
  hi: number,
): string {
  if (values.length === 1) return `0,${height / 2} ${width},${height / 2}`;
  const step = width / (values.length - 1);
  const span = hi - lo || 1;
  return values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - lo) / span) * height).toFixed(1)}`)
    .join(' ');
}

export function Sparkline({
  values,
  colour = 'var(--color-forest)',
}: {
  values: number[];
  colour?: string;
}) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return (
    <svg width="88" height="32" viewBox="0 0 88 32" aria-hidden="true" className="flex-none">
      <polyline
        points={linePoints(values, 84, 28, lo, hi)
          .split(' ')
          .map((p) =>
            p
              .split(',')
              .map((n, i) => Number(n) + (i === 0 ? 2 : 2))
              .join(','),
          )
          .join(' ')}
        fill="none"
        stroke={colour}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** "Nice" axis bounds around a range, so lines do not hug the edges. */
export function axis(values: number[], ticks = 3): { lo: number; hi: number; labels: number[] } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const raw = (max - min || max || 1) / (ticks - 1);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.max(lo + step * (ticks - 1), Math.ceil(max / step) * step);
  const n = Math.round((hi - lo) / step);
  return { lo, hi, labels: Array.from({ length: n + 1 }, (_, i) => hi - i * step) };
}

export const billions = (v: bigint) => Number(v / 1_000_000n) / 1000;
export const compact = (v: string) => formatRwfCompact(BigInt(v), { symbol: false });
export const pct = (bps: number) => formatBps(bps);
