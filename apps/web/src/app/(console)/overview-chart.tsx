'use client';

import { formatRwfCompact } from '@kora/core';
import { CardTitle, SegmentedControl } from '@kora/ui';
import { useState } from 'react';
import type { Overview } from '@/lib/types';

type Range = '3M' | '12M';

/** Disbursed against collected, month by month. Bars are scaled to the tallest month. */
export function OverviewChart({ series }: { series: Overview['series'] }) {
  const [range, setRange] = useState<Range>('12M');
  const shown = range === '3M' ? series.slice(-3) : series;
  const values = shown.map((m) => ({
    ...m,
    d: BigInt(m.disbursed),
    c: BigInt(m.collected),
  }));
  const max = values.reduce((top, m) => (m.d > top ? m.d : m.c > top ? m.c : top), 1n);
  const height = (v: bigint) => `${Math.max(v > 0n ? 2 : 0, Number((v * 1000n) / max) / 10)}%`;
  const barWidth = range === '3M' ? 'max-w-10' : 'max-w-[18px]';
  const first = shown[0]?.label ?? '';
  const last = shown[shown.length - 1]?.label ?? '';

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <CardTitle className="mr-auto">Disbursements vs collections</CardTitle>
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span className="size-2.5 rounded-[3px] bg-forest" />
          Disbursed
        </span>
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          <span className="size-2.5 rounded-[3px] bg-lime-deep" />
          Collected
        </span>
        <SegmentedControl
          label="Range"
          value={range}
          onChange={setRange}
          options={[
            { value: '3M', label: '3M' },
            { value: '12M', label: '12M' },
          ]}
        />
      </div>
      <div
        role="img"
        aria-label={`Monthly disbursed and collected amounts, ${first} to ${last}`}
        className="flex h-[220px] items-end gap-2.5 border-b border-line"
      >
        {values.map((m) => (
          <div key={m.month} className="flex h-full flex-1 items-end justify-center gap-[3px]">
            <div
              className={`w-2/5 rounded-t-md rounded-b-sm bg-forest ${barWidth}`}
              style={{ height: height(m.d) }}
              title={`${m.label}: disbursed ${formatRwfCompact(m.d)}`}
            />
            <div
              className={`w-2/5 rounded-t-md rounded-b-sm bg-lime-deep ${barWidth}`}
              style={{ height: height(m.c) }}
              title={`${m.label}: collected ${formatRwfCompact(m.c)}`}
            />
          </div>
        ))}
      </div>
      <div className="-mt-1 flex gap-2.5" aria-hidden="true">
        {values.map((m) => (
          <span key={m.month} className="flex-1 text-center text-[11px] text-ink-muted">
            {m.label}
          </span>
        ))}
      </div>
      {/* The same figures as a table, for screen readers. */}
      <table className="sr-only">
        <caption>Disbursed and collected by month</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Disbursed</th>
            <th scope="col">Collected</th>
          </tr>
        </thead>
        <tbody>
          {values.map((m) => (
            <tr key={m.month}>
              <th scope="row">{m.label}</th>
              <td>{formatRwfCompact(m.d)}</td>
              <td>{formatRwfCompact(m.c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
