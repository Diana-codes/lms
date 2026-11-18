import { formatBps, formatDate } from '@kora/core';
import { Money } from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PrintButton } from '../../loans/[code]/statement/print-button';
import { serverApi } from '@/lib/server-api';
import type { Report } from '@/lib/types';

export const metadata: Metadata = { title: 'Report' };

/** The report as a printable page. "Print" saves it as a PDF from the browser. */
export default async function PrintReport({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const raw = (await searchParams).period;
  const period = raw === 'Q' || raw === 'YTD' ? raw : '12M';
  const res = await serverApi<Report>(`/reports?period=${period}`);
  if (!res.ok) return <p>Couldn’t load the report.</p>;
  const r = res.data;
  const th =
    'border-b border-line px-2 py-2 text-left text-xs font-medium text-ink-muted first:pl-0 last:pr-0';
  const td = 'border-b border-line-soft px-2 py-2 first:pl-0 last:pr-0';
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/reports?period=${period}`} className="mr-auto text-sm font-semibold">
          ← Back to reports
        </Link>
        <PrintButton />
      </div>
      <article className="flex min-w-0 flex-col gap-6 rounded-card border border-line bg-surface p-5 text-sm md:p-8 print:border-0 print:p-0">
        <header className="flex flex-col gap-1">
          <span className="font-display text-lg font-semibold text-forest">Bridge to Finance</span>
          <h1 className="m-0 font-display text-[26px] font-semibold">Portfolio report</h1>
          <span className="text-ink-muted">
            {formatDate(r.from)} to {formatDate(r.asOf)} · all branches
          </span>
        </header>
        {(
          [
            [
              'By month',
              [
                'Month end',
                'Outstanding (RWF)',
                'Active loans',
                'Average loan (RWF)',
                'PAR 30',
                'Yield',
              ],
              r.series.map((m) => [
                formatDate(m.month),
                <Money key="o" amount={m.outstanding} bare />,
                m.activeLoans.toLocaleString('en-US'),
                <Money key="a" amount={m.averageLoan} bare />,
                formatBps(m.par30Bps),
                formatBps(m.yieldBps),
              ]),
            ],
            [
              'By product',
              ['Product', 'Outstanding (RWF)', 'Share'],
              r.products.map((p) => [
                p.name,
                <Money key="o" amount={p.outstanding} bare />,
                formatBps(p.shareBps),
              ]),
            ],
            [
              'By loan officer',
              ['Officer', 'Active loans', 'Portfolio (RWF)', 'PAR 30', 'Collection rate'],
              r.officers.map((o) => [
                o.name,
                o.activeLoans.toLocaleString('en-US'),
                <Money key="p" amount={o.portfolio} bare />,
                formatBps(o.par30Bps),
                o.collectionRateBps == null ? '—' : formatBps(o.collectionRateBps),
              ]),
            ],
          ] as const
        ).map(([title, heads, rows]) => (
          <section key={title} className="flex flex-col gap-2">
            <h2 className="m-0 font-display text-base font-semibold">{title}</h2>
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-[520px] border-collapse tabular-nums">
                <thead>
                  <tr>
                    {heads.map((h, i) => (
                      <th key={h} scope="col" className={`${th} ${i > 0 ? 'text-right' : ''}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j} className={`${td} ${j > 0 ? 'text-right' : ''}`}>
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
        <p className="m-0 text-xs text-ink-muted">
          Figures are rebuilt from the ledger and repayment schedules as at each month end. PAR 30:
          outstanding principal more than 30 days late, as a share of all outstanding principal.
        </p>
      </article>
    </>
  );
}
