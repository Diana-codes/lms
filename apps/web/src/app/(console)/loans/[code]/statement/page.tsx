import { formatDate, INSTALMENT_STATE_LABELS } from '@kora/core';
import { buttonClasses, EmptyState, Money, WarningIcon } from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { rate } from '@/lib/format';
import { serverApi } from '@/lib/server-api';
import type { LoanDetail } from '@/lib/types';
import { PrintButton } from './print-button';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  return { title: `Statement ${(await params).code}` };
}

/** A printable loan statement. "Print" saves it as a PDF from the browser. */
export default async function StatementPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const res = await serverApi<LoanDetail>(`/loans/${encodeURIComponent(code)}`);
  if (!res.ok) {
    return (
      <EmptyState
        icon={<WarningIcon />}
        title="Couldn’t load this statement"
        action={
          <Link href="/loans" className={buttonClasses({ variant: 'secondary' })}>
            Back to loans
          </Link>
        }
      />
    );
  }
  const loan = res.data;
  const th =
    'border-b border-line px-2 py-2 text-left text-xs font-medium text-ink-muted first:pl-0 last:pr-0';
  const td = 'border-b border-line-soft px-2 py-2 first:pl-0 last:pr-0';
  const payments = [...loan.payments].reverse();

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/loans/${loan.code}`} className="mr-auto text-sm font-semibold">
          ← Back to {loan.code}
        </Link>
        <PrintButton />
      </div>

      <article className="flex flex-col gap-6 min-w-0 rounded-card border border-line bg-surface p-5 text-sm md:p-8 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start gap-4">
          <div className="mr-auto flex flex-col gap-1">
            <span className="font-display text-lg font-semibold text-forest">Kora Lend</span>
            <h1 className="m-0 font-display text-[26px] leading-tight font-semibold">
              Loan statement
            </h1>
            <span className="text-ink-muted">
              {loan.code} · as of {formatDate(loan.asOf)}
            </span>
          </div>
          <div className="flex flex-col text-right">
            <span className="font-semibold">{loan.borrower.name}</span>
            <span className="text-ink-muted">{loan.borrower.code}</span>
            <span className="text-ink-muted">{loan.borrower.phone}</span>
          </div>
        </header>

        <dl className="m-0 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(
            [
              ['Product', loan.productName],
              ['Principal', <Money key="p" amount={loan.terms.principal} />],
              [
                'Rate and term',
                `${rate(loan.terms.annualRateBps)} p.a. · ${loan.terms.termMonths} months`,
              ],
              ['Disbursed', loan.terms.disbursedOn ? formatDate(loan.terms.disbursedOn) : '—'],
              ['Total repaid', <Money key="r" amount={loan.figures.totalRepaid} />],
              [
                'Outstanding principal',
                <Money key="o" amount={loan.figures.outstandingPrincipal} />,
              ],
              ['Instalments paid', `${loan.figures.paidCount} of ${loan.figures.instalmentCount}`],
              ['Status', loan.statusLabel],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-xs text-ink-muted">{label}</dt>
              <dd className="m-0 font-semibold">{value}</dd>
            </div>
          ))}
        </dl>

        <section className="flex flex-col gap-2">
          <h2 className="m-0 font-display text-base font-semibold">Payments received</h2>
          {payments.length === 0 ? (
            <p className="m-0 text-ink-muted">No payments yet.</p>
          ) : (
            <div className="overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-[560px] border-collapse tabular-nums">
                <thead>
                  <tr>
                    <th scope="col" className={th}>
                      Date
                    </th>
                    <th scope="col" className={th}>
                      For
                    </th>
                    <th scope="col" className={th}>
                      Channel
                    </th>
                    <th scope="col" className={th}>
                      Reference
                    </th>
                    <th scope="col" className={`${th} text-right`}>
                      Amount (RWF)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className={td}>{formatDate(p.receivedOn)}</td>
                      <td className={td}>{p.note ?? 'Payment'}</td>
                      <td className={td}>{p.channel}</td>
                      <td className={td}>{p.reference ?? '—'}</td>
                      <td className={`${td} text-right font-semibold`}>
                        <Money amount={p.amount} bare />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="m-0 font-display text-base font-semibold">Repayment schedule</h2>
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[560px] border-collapse tabular-nums">
              <thead>
                <tr>
                  <th scope="col" className={th}>
                    #
                  </th>
                  <th scope="col" className={th}>
                    Due date
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Principal
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Interest
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Instalment
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Balance
                  </th>
                  <th scope="col" className={th}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {loan.schedule.map((r) => (
                  <tr key={r.number}>
                    <td className={td}>{r.number}</td>
                    <td className={td}>{formatDate(r.dueDate)}</td>
                    <td className={`${td} text-right`}>
                      <Money amount={r.principal} bare />
                    </td>
                    <td className={`${td} text-right`}>
                      <Money amount={r.interest} bare />
                    </td>
                    <td className={`${td} text-right font-semibold`}>
                      <Money amount={r.payment} bare />
                    </td>
                    <td className={`${td} text-right`}>
                      <Money amount={r.balanceAfter} bare />
                    </td>
                    <td className={td}>{INSTALMENT_STATE_LABELS[r.state]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <p className="m-0 text-xs text-ink-muted">
          Amounts are in Rwandan francs (RWF). Interest is charged monthly on the reducing balance.
        </p>
      </article>
    </>
  );
}
