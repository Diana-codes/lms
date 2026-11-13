'use client';

import { formatBps, formatDate, formatRwfCompact } from '@kora/core';
import { buttonClasses, Card, CardTitle, cx, Money, SegmentedControl } from '@kora/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { count } from '@/lib/format';
import type { Report, ReportPeriod } from '@/lib/types';
import { AskYourData } from './ask-your-data';
import { Fairness } from './fairness';
import { axis, billions, linePoints, Sparkline } from './charts';

const PERIOD_TEXT: Record<ReportPeriod, string> = {
  Q: 'Last 3 months',
  YTD: 'Year to date',
  '12M': 'Last 12 months',
};
const PERIOD_NAME: Record<ReportPeriod, string> = {
  Q: 'last 3 months',
  YTD: 'this year',
  '12M': '12 months',
};
const PRODUCT_COLOURS = ['bg-forest', 'bg-[#2F6B52]', 'bg-[#6E9E3A]', 'bg-lime-deep', 'bg-lime'];
/** PAR 30 target from the design. */
const PAR_TARGET_BPS = 300;

function pctChange(first: bigint | number, last: bigint | number): string | null {
  const a = Number(first);
  const b = Number(last);
  if (!a) return null;
  const d = Math.round((b / a - 1) * 100);
  return `${d >= 0 ? '+' : '−'}${Math.abs(d)}%`;
}

export function ReportView({ report }: { report: Report }) {
  const router = useRouter();
  const pathname = usePathname();
  const { series, period } = report;
  const first = series[0]!;
  const last = series[series.length - 1]!;
  const name = PERIOD_NAME[period];

  const loansDelta = last.activeLoans - first.activeLoans;
  const yieldDelta = (last.yieldBps - first.yieldBps) / 100;
  const kpis = [
    {
      label: 'Outstanding portfolio',
      value: <Money amount={last.outstanding} compact />,
      values: series.map((m) => Number(BigInt(m.outstanding) / 1000n)),
      delta: pctChange(BigInt(first.outstanding), BigInt(last.outstanding)),
      good: true,
    },
    {
      label: 'Active loans',
      value: count(last.activeLoans),
      values: series.map((m) => m.activeLoans),
      delta: `${loansDelta >= 0 ? '+' : '−'}${count(Math.abs(loansDelta))}`,
      good: true,
    },
    {
      label: 'Average loan size',
      value: <Money amount={last.averageLoan} compact />,
      values: series.map((m) => Number(BigInt(m.averageLoan) / 1000n)),
      delta: pctChange(BigInt(first.averageLoan), BigInt(last.averageLoan)),
      good: true,
    },
    {
      label: 'Portfolio yield',
      value: formatBps(last.yieldBps),
      values: series.map((m) => m.yieldBps),
      delta: `${yieldDelta > 0 ? '+' : yieldDelta < 0 ? '−' : '±'}${Math.abs(yieldDelta).toFixed(1)} pts`,
      good: false,
    },
  ];

  const growth = series.map((m) => billions(BigInt(m.outstanding)));
  const g = axis(growth);
  const par = series.map((m) => m.par30Bps / 100);
  const p = axis([...par, PAR_TARGET_BPS / 100]);
  const top = report.products[0] ? BigInt(report.products[0].outstanding) : 1n;
  const total = BigInt(last.outstanding);

  return (
    <>
      <header className="flex flex-wrap items-center gap-4">
        <div className="mr-auto flex flex-col gap-1">
          <span className="text-[13px] text-ink-muted">
            {PERIOD_TEXT[period]} · all branches · as of {formatDate(report.asOf)}
          </span>
          <h1 className="m-0 font-display text-[30px] leading-tight font-semibold tracking-[-0.02em]">
            Reports
          </h1>
        </div>
        <SegmentedControl
          label="Period"
          value={period}
          onChange={(v) => router.push(`${pathname}?period=${v}`)}
          options={[
            { value: 'Q', label: 'Quarter' },
            { value: 'YTD', label: 'Year to date' },
            { value: '12M', label: '12 months' },
          ]}
          className="border border-line bg-surface"
        />
        <a
          href={`/api/reports/export.csv?period=${period}`}
          className={buttonClasses({ variant: 'secondary' })}
          download
        >
          Export CSV
        </a>
        <Link
          href={`/reports/print?period=${period}`}
          className={buttonClasses({ variant: 'secondary' })}
        >
          Print or PDF
        </Link>
      </header>

      <AskYourData />

      <section
        aria-label="Summary"
        className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4"
      >
        {kpis.map((k) => (
          <div
            key={k.label}
            className="flex flex-col gap-2.5 rounded-card border border-line bg-surface p-5"
          >
            <span className="text-[13px] text-ink-muted">{k.label}</span>
            <div className="flex items-end justify-between gap-2">
              <span className="font-display text-[28px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
                {k.value}
              </span>
              {k.values.length > 1 ? (
                <Sparkline
                  values={k.values}
                  colour={k.good ? 'var(--color-forest)' : 'var(--color-ink-muted)'}
                />
              ) : null}
            </div>
            <span
              className={cx(
                'text-xs font-semibold',
                k.good ? 'text-positive-fg' : 'text-ink-muted',
              )}
            >
              {k.delta ?? '—'} over {name}
            </span>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap gap-4">
        <Card className="flex-[2_1_520px]">
          <div className="flex flex-wrap items-baseline gap-3">
            <CardTitle className="mr-auto">Portfolio growth</CardTitle>
            <span className="text-xs text-ink-muted">Outstanding balance, RWF billions</span>
          </div>
          <div className="flex gap-2">
            <div
              className="flex h-[220px] flex-col justify-between text-right text-[11px] text-ink-muted tabular-nums"
              aria-hidden="true"
            >
              {g.labels.map((l) => (
                <span key={l}>{l.toFixed(2).replace(/\.?0+$/, '')}</span>
              ))}
            </div>
            <div className="relative h-[220px] flex-1 border-b border-line">
              <div className="absolute inset-0 flex flex-col justify-between" aria-hidden="true">
                {g.labels.map((l) => (
                  <span key={l} className="border-t border-dashed border-line-soft" />
                ))}
              </div>
              <svg
                role="img"
                aria-label={`Outstanding balance from ${formatRwfCompact(BigInt(first.outstanding))} in ${first.label} to ${formatRwfCompact(BigInt(last.outstanding))} in ${last.label}`}
                viewBox="0 0 600 220"
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full"
              >
                <polygon
                  points={`0,220 ${linePoints(growth, 600, 220, g.lo, g.hi)} 600,220`}
                  fill="var(--color-lime)"
                  fillOpacity="0.35"
                />
                <polyline
                  points={linePoints(growth, 600, 220, g.lo, g.hi)}
                  fill="none"
                  stroke="var(--color-forest)"
                  strokeWidth="2.5"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <span className="absolute -top-1 right-0 rounded-pill bg-forest px-2 py-0.5 text-[11px] font-semibold text-lime">
                {formatRwfCompact(BigInt(last.outstanding), { symbol: false })}
              </span>
            </div>
          </div>
          <div className="flex pl-8" aria-hidden="true">
            {series.map((m) => (
              <span key={m.month} className="flex-1 text-center text-[11px] text-ink-muted">
                {m.label}
              </span>
            ))}
          </div>
        </Card>

        <Card className="flex-[1_1_300px]">
          <div className="flex flex-col gap-1">
            <CardTitle>Portfolio by product</CardTitle>
            <span className="text-xs text-ink-muted">
              Share of <Money amount={total} compact /> outstanding
            </span>
          </div>
          {report.products.map((prod, i) => (
            <div key={prod.name} className="flex flex-col gap-1.5">
              <div className="flex justify-between gap-2 text-sm">
                <span className="font-medium">{prod.name}</span>
                <span className="text-ink-muted tabular-nums">
                  <Money amount={prod.outstanding} compact /> · {formatBps(prod.shareBps, 0)}
                </span>
              </div>
              <div className="h-2.5 rounded-pill bg-neutral-bg">
                <div
                  className={cx('h-2.5 rounded-pill', PRODUCT_COLOURS[i] ?? 'bg-lime')}
                  style={{ width: `${Number((BigInt(prod.outstanding) * 1000n) / top) / 10}%` }}
                />
              </div>
            </div>
          ))}
        </Card>
      </div>

      <div className="flex flex-wrap gap-4">
        <Card className="flex-[1_1_380px]">
          <div className="flex flex-wrap items-baseline gap-3">
            <CardTitle className="mr-auto">Portfolio at risk (30+)</CardTitle>
            <span
              className={cx(
                'text-xs font-semibold',
                last.par30Bps > PAR_TARGET_BPS ? 'text-caution-fg' : 'text-positive-fg',
              )}
            >
              {formatBps(last.par30Bps)} · target ≤ {formatBps(PAR_TARGET_BPS)}
            </span>
          </div>
          <div className="relative h-40 border-b border-line">
            <span
              aria-hidden="true"
              className="absolute right-0 left-0 border-t-2 border-dashed border-rust/60"
              style={{ top: `${(1 - (PAR_TARGET_BPS / 100 - p.lo) / (p.hi - p.lo)) * 100}%` }}
            />
            <span
              className="absolute right-0 text-[11px] font-semibold text-caution-fg"
              style={{
                top: `calc(${(1 - (PAR_TARGET_BPS / 100 - p.lo) / (p.hi - p.lo)) * 100}% - 16px)`,
              }}
            >
              Target {formatBps(PAR_TARGET_BPS)}
            </span>
            <svg
              role="img"
              aria-label={`PAR 30 by month: ${series.map((m) => `${m.label} ${formatBps(m.par30Bps)}`).join(', ')}`}
              viewBox="0 0 600 160"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full"
            >
              <polyline
                points={linePoints(par, 600, 160, p.lo, p.hi)}
                fill="none"
                stroke="var(--color-ink)"
                strokeWidth="2.5"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
          <div className="flex" aria-hidden="true">
            {series.map((m) => (
              <span key={m.month} className="flex-1 text-center text-[11px] text-ink-muted">
                {m.label}
              </span>
            ))}
          </div>
        </Card>

        <Card className="flex-[1_1_480px]">
          <CardTitle>Loan officer performance</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  {['Officer', 'Active loans', 'Portfolio', 'PAR 30', 'Collection rate'].map(
                    (h, i) => (
                      <th
                        key={h}
                        scope="col"
                        className={cx(
                          'border-b border-line px-2 pt-2 pb-2.5 font-medium first:pl-0 last:pr-0',
                          i > 0 && i < 3 && 'text-right',
                        )}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {report.officers.map((o) => (
                  <tr
                    key={o.name}
                    className="[&>td]:border-b [&>td]:border-line-soft [&>td]:px-2 [&>td]:py-3 [&>td:first-child]:pl-0 [&>td:last-child]:pr-0"
                  >
                    <td>
                      <span className="flex items-center gap-2.5">
                        <span className="flex size-[30px] items-center justify-center rounded-full bg-avatar-bg text-[11px] font-semibold text-forest">
                          {o.initials}
                        </span>
                        <span className="font-medium">{o.name}</span>
                      </span>
                    </td>
                    <td className="text-right">{count(o.activeLoans)}</td>
                    <td className="text-right font-semibold">
                      <Money amount={o.portfolio} compact />
                    </td>
                    <td>
                      <span
                        className={cx(
                          'rounded-pill px-2 py-[3px] font-semibold',
                          o.par30Bps > PAR_TARGET_BPS
                            ? 'bg-danger-bg text-danger-fg'
                            : 'bg-success-bg text-success-fg',
                        )}
                      >
                        {formatBps(o.par30Bps)}
                      </span>
                    </td>
                    <td>
                      {o.collectionRateBps == null ? (
                        '—'
                      ) : (
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-20 rounded-pill bg-neutral-bg">
                            <span
                              className="block h-1.5 rounded-pill bg-forest"
                              style={{
                                width: `${Math.max(0, Math.min(100, (o.collectionRateBps / 100 - 90) * 10))}%`,
                              }}
                            />
                          </span>
                          <span className="font-semibold">{formatBps(o.collectionRateBps)}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-0 text-xs text-ink-muted">
            Collection rate: of instalments due in the period, the share paid so far. Bars start at
            90%.
          </p>
        </Card>
      </div>

      <div className="flex flex-wrap gap-4">
        <Fairness />
      </div>
    </>
  );
}
