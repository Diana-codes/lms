import { formatBps } from '@kora/core';
import { Card, CardTitle, Money, Pill } from '@kora/ui';
import type { ReactNode } from 'react';
import { count } from '@/lib/format';
import type { ClassificationReport } from '@/lib/types';

/** BNR Regulation 59/2023 Art. 34 — portfolio classification and provisions. */
export function Classification({ report }: { report: ClassificationReport }) {
  const shortfall = BigInt(report.requiredProvision) - BigInt(report.allowanceHeld);
  return (
    <Card>
      <div className="flex flex-wrap items-baseline gap-3">
        <CardTitle className="mr-auto">Credit classification</CardTitle>
        <span className="text-xs text-ink-muted">
          BNR 59/2023 · {report.profile === 'COMPANY' ? 'company' : 'cooperative'} schedule · as of{' '}
          {report.asOf}
        </span>
        <a
          href={`/api/reports/classification.csv?asOf=${report.asOf}`}
          className="text-xs font-semibold text-forest underline-offset-2 hover:underline"
          download
        >
          Export CSV
        </a>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-4 text-sm">
        <Stat label="Outstanding" value={<Money amount={report.outstandingPrincipal} compact />} />
        <Stat label="NPL ratio" value={formatBps(report.nplBps)} />
        <Stat label="Required provision" value={<Money amount={report.requiredProvision} compact />} />
        <Stat label="Allowance held" value={<Money amount={report.allowanceHeld} compact />} />
        <Stat
          label={shortfall > 0n ? 'Shortfall' : shortfall < 0n ? 'Surplus' : 'Coverage'}
          value={
            shortfall === 0n ? (
              <Pill tone="success">Fully covered</Pill>
            ) : (
              <Money amount={shortfall < 0n ? -shortfall : shortfall} compact />
            )
          }
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-muted">
              <th className="py-2 pr-3 font-medium">Class</th>
              <th className="py-2 pr-3 font-medium tabular-nums">Loans</th>
              <th className="py-2 pr-3 font-medium">Outstanding</th>
              <th className="py-2 pr-3 font-medium">Provision rate</th>
              <th className="py-2 font-medium">Required provision</th>
            </tr>
          </thead>
          <tbody>
            {report.buckets.map((b) => (
              <tr key={b.creditClass} className="border-b border-line-soft">
                <td className="py-2.5 pr-3">
                  <span className="font-medium">{b.label}</span>
                  {b.nonPerforming ? (
                    <span className="ml-2 text-xs text-ink-muted">NPL</span>
                  ) : null}
                </td>
                <td className="py-2.5 pr-3 tabular-nums">{count(b.loanCount)}</td>
                <td className="py-2.5 pr-3">
                  <Money amount={b.outstandingPrincipal} />
                </td>
                <td className="py-2.5 pr-3 tabular-nums">{formatBps(b.provisionBps, 0)}</td>
                <td className="py-2.5">
                  <Money amount={b.requiredProvision} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="font-display text-lg font-semibold tracking-[-0.02em]">{value}</span>
    </div>
  );
}
