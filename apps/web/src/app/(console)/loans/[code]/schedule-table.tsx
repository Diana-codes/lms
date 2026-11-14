'use client';

import { formatDate, INSTALMENT_STATE_LABELS, type InstalmentState } from '@kora/core';
import { Button, Card, CardTitle, cx, Money } from '@kora/ui';
import { useState } from 'react';
import type { ScheduleRow } from '@/lib/types';

const PILL: Record<InstalmentState, string> = {
  PAID: 'bg-success-bg text-success-fg',
  PARTIAL: 'bg-warning-bg text-warning-fg',
  OVERDUE: 'bg-danger-bg text-danger-fg',
  DUE_NEXT: 'bg-ink text-lime',
  UPCOMING: 'bg-neutral-bg text-neutral-fg',
};

/** How many rows show before "Show all". */
const COLLAPSED_ROWS = 9;

export function ScheduleTable({ rows, subtitle }: { rows: ScheduleRow[]; subtitle: string }) {
  const [all, setAll] = useState(false);
  const hasFees = rows.some((r) => r.fee !== '0');
  const shown = all ? rows : rows.slice(0, COLLAPSED_ROWS);
  const th = 'border-b border-line p-2 font-medium first:pl-0 last:pr-0';
  const td = 'border-b border-line-soft px-2 py-[11px] first:pl-0 last:pr-0';

  return (
    <Card className="gap-3.5">
      <div className="flex items-center gap-3">
        <CardTitle className="mr-auto">Repayment schedule</CardTitle>
        <span className="text-xs text-ink-muted">{subtitle} · RWF</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th scope="col" className={th}>
                #
              </th>
              <th scope="col" className={th}>
                Due date
              </th>
              <th scope="col" className={cx(th, 'text-right')}>
                Principal
              </th>
              <th scope="col" className={cx(th, 'text-right')}>
                Interest
              </th>
              {hasFees ? (
                <th scope="col" className={cx(th, 'text-right')}>
                  Fees
                </th>
              ) : null}
              <th scope="col" className={cx(th, 'text-right')}>
                Instalment
              </th>
              <th scope="col" className={cx(th, 'text-right')}>
                Balance
              </th>
              <th scope="col" className={th}>
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.number}
                className={
                  r.state === 'DUE_NEXT'
                    ? 'bg-lime-tint'
                    : r.state === 'OVERDUE'
                      ? 'bg-danger-bg/40'
                      : undefined
                }
              >
                <td className={cx(td, 'text-ink-muted')}>{r.number}</td>
                <td className={cx(td, 'whitespace-nowrap')}>{formatDate(r.dueDate)}</td>
                <td className={cx(td, 'text-right')}>
                  <Money amount={r.principal} bare />
                </td>
                <td className={cx(td, 'text-right text-ink-muted')}>
                  <Money amount={r.interest} bare />
                </td>
                {hasFees ? (
                  <td className={cx(td, 'text-right text-ink-muted')}>
                    <Money amount={r.fee} bare />
                  </td>
                ) : null}
                <td className={cx(td, 'text-right font-semibold')}>
                  <Money amount={r.payment} bare />
                </td>
                <td className={cx(td, 'text-right')}>
                  <Money amount={r.balanceAfter} bare />
                </td>
                <td className={td}>
                  <span
                    className={cx(
                      'inline-block rounded-pill px-[9px] py-[3px] text-xs font-semibold whitespace-nowrap',
                      PILL[r.state],
                    )}
                  >
                    {INSTALMENT_STATE_LABELS[r.state]}
                  </span>
                  {r.state === 'PARTIAL' || (r.state === 'OVERDUE' && r.paid !== '0') ? (
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      <Money amount={r.remaining} bare /> left
                    </span>
                  ) : null}
                  {r.penalty !== '0' ? (
                    <span className="mt-0.5 block text-xs text-danger-fg">
                      + <Money amount={r.penalty} bare /> late charges
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > COLLAPSED_ROWS ? (
        <Button
          variant="secondary"
          className="self-start"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
        >
          {all ? 'Show fewer' : `Show all ${rows.length} instalments`}
        </Button>
      ) : null}
    </Card>
  );
}
