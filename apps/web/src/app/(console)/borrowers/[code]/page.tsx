import { formatBps, formatDate } from '@kora/core';
import {
  BorrowersIcon,
  buttonClasses,
  Card,
  CardTitle,
  EmptyState,
  Money,
  Pill,
  SparkleIcon,
  WarningIcon,
} from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumb } from '@/components/list-tools';
import { serverApi } from '@/lib/server-api';
import type { BorrowerProfile, Me } from '@/lib/types';
import { SendSmsButton } from '@/components/send-sms-button';
import { AiSummaryButton } from './ai-summary-button';
import { DocumentsCard } from './documents-card';
import { NoteForm } from './note-form';
import { OfferButton } from './offer-button';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  return { title: (await params).code };
}

const CELL: Record<BorrowerProfile['history']['cells'][number], string> = {
  ON_TIME: 'bg-forest',
  EARLY: 'bg-lime-deep',
  LATE: 'bg-amber',
  MISSED: 'bg-rust',
  UPCOMING: 'border-[1.5px] border-dashed border-[#A7ADA3]',
};
const LEGEND: Array<[BorrowerProfile['history']['cells'][number], string]> = [
  ['ON_TIME', 'On time'],
  ['EARLY', 'Early'],
  ['LATE', 'Late'],
  ['MISSED', 'Overdue'],
  ['UPCOMING', 'Upcoming'],
];

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="m-0 text-right font-medium">{children}</dd>
    </div>
  );
}

export default async function BorrowerPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [res, me] = await Promise.all([
    serverApi<BorrowerProfile>(`/borrowers/${encodeURIComponent(code)}`),
    serverApi<Me>('/auth/me'),
  ]);

  if (!res.ok) {
    const missing = res.status === 404 || res.status === 400;
    return (
      <>
        <Breadcrumb parent="Borrowers" parentHref="/borrowers" current={code} />
        <EmptyState
          icon={missing ? <BorrowersIcon size={22} /> : <WarningIcon />}
          title={missing ? 'No borrower with that number' : 'Couldn’t load this borrower'}
          action={
            <Link href="/borrowers" className={buttonClasses({ variant: 'secondary' })}>
              Back to borrowers
            </Link>
          }
        >
          {missing
            ? `Nothing matches ${code}.`
            : 'The server didn’t answer. Reload the page to try again.'}
        </EmptyState>
      </>
    );
  }

  const b = res.data;
  const used = b.history.cells.filter((c, i, all) => all.indexOf(c) === i);
  const paidCells = b.history.cells.filter((c) => c !== 'UPCOMING' && c !== 'MISSED').length;
  const upcomingCells = b.history.cells.filter((c) => c === 'UPCOMING').length;

  return (
    <>
      <Breadcrumb parent="Borrowers" parentHref="/borrowers" current={b.code} />

      <header className="flex flex-wrap items-center gap-[18px] rounded-[22px] border border-line bg-surface p-[22px]">
        <span
          aria-hidden="true"
          className="flex size-[72px] flex-none items-center justify-center rounded-[22px] bg-forest font-display text-[26px] font-semibold text-lime"
        >
          {b.initials}
        </span>
        <div className="mr-auto flex flex-col gap-1.5">
          <h1 className="m-0 font-display text-[28px] leading-tight font-semibold tracking-[-0.02em]">
            {b.name}
          </h1>
          <span className="text-sm text-ink-muted">{b.subtitle.join(' · ')}</span>
          <div className="flex flex-wrap gap-1.5">
            {b.tags.map((tag) => (
              <Pill key={tag.label} tone={tag.tone}>
                {tag.label}
              </Pill>
            ))}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-3">
          <SendSmsButton
            borrowerCode={b.code}
            name={b.name}
            phone={b.contact.phone}
            loanCode={b.loans.find((l) => l.status === 'ACTIVE')?.code}
          />
          <OfferButton borrower={b} />
        </div>
      </header>

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <section className="flex flex-col gap-4 rounded-[22px] bg-forest p-[22px] text-white">
            <div className="flex items-center">
              <h2 className="m-0 mr-auto font-display text-base font-semibold">Credit score</h2>
              {b.score ? (
                <span className="text-xs text-forest-muted">
                  Updated {formatDate(b.score.updatedOn, { year: false })}
                </span>
              ) : null}
            </div>
            {b.score ? (
              <>
                <div className="flex items-baseline gap-2.5">
                  <span className="font-display text-5xl leading-none font-semibold tracking-[-0.03em]">
                    {b.score.value}
                  </span>
                  {b.score.change != null && b.score.change !== 0 ? (
                    <span className="text-[13px] font-semibold text-lime">
                      {b.score.change > 0 ? '+' : '−'}
                      {Math.abs(b.score.change)} in 6 months
                    </span>
                  ) : (
                    <span className="text-[13px] font-semibold text-lime">{b.score.label}</span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <div
                    role="img"
                    aria-label={`Score ${b.score.value} on a scale of 300 to 850`}
                    className="relative h-2.5 rounded-pill"
                    style={{
                      background:
                        'linear-gradient(90deg, var(--color-rust) 0%, var(--color-amber) 35%, var(--color-lime-deep) 65%, var(--color-lime) 100%)',
                    }}
                  >
                    <span
                      className="absolute -top-[5px] -ml-2.5 box-border size-5 rounded-full border-4 border-forest bg-white"
                      style={{ left: `${b.score.percent}%` }}
                    />
                  </div>
                  <div className="flex text-[11px] text-forest-muted">
                    <span className="mr-auto">300</span>
                    <span>850</span>
                  </div>
                </div>
              </>
            ) : (
              <p className="m-0 text-sm text-forest-muted">
                Not scored yet. Scoring arrives in Phase 5.
              </p>
            )}
            <dl className="m-0 grid grid-cols-2 gap-3 text-[13px]">
              <div className="flex flex-col gap-0.5">
                <dt className="text-forest-muted">On-time payments</dt>
                <dd className="m-0 font-semibold">
                  {b.onTimeRateBps == null ? '—' : formatBps(b.onTimeRateBps, 0)}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-forest-muted">Debt-to-income</dt>
                <dd className="m-0 font-semibold">
                  {b.debtToIncomeBps == null
                    ? 'Income not verified'
                    : formatBps(b.debtToIncomeBps, 0)}
                </dd>
              </div>
            </dl>
          </section>

          <DocumentsCard
            borrower={b}
            canReview={me.ok && ['LOAN_OFFICER', 'MANAGER', 'ADMIN'].includes(me.data.role)}
          />

          <Card className="gap-3 p-[22px] text-sm">
            <h2 className="m-0 font-display text-base font-semibold">Contact &amp; business</h2>
            <dl className="m-0 flex flex-col gap-3">
              <Line label="Phone">{b.contact.phone}</Line>
              {b.contact.nationalId ? (
                <Line label="National ID">{b.contact.nationalId}</Line>
              ) : null}
              <Line label="MoMo wallet">{b.contact.momoLinked ? 'Linked' : 'Not linked'}</Line>
              {b.contact.sector ? <Line label="Sector">{b.contact.sector}</Line> : null}
              <Line label="Avg. monthly revenue">
                {b.contact.monthlyRevenue ? (
                  <Money amount={b.contact.monthlyRevenue} />
                ) : (
                  'Not verified'
                )}
              </Line>
              <Line label="Relationship officer">{b.contact.officerName ?? 'Unassigned'}</Line>
            </dl>
          </Card>
        </div>

        <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-4">
          {b.aiSummary ? (
            <section
              aria-label="AI summary"
              className="flex flex-col gap-3 rounded-card border border-ai-line bg-ai-tint p-5 text-ai-ink"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 flex-none items-center justify-center rounded-nav bg-ai text-white">
                  <SparkleIcon size={16} />
                </span>
                <h2 className="m-0 mr-auto font-display text-base font-semibold">AI summary</h2>
                <span className="text-xs text-ai-ink-soft">
                  Updated {formatDate(b.aiSummary.updatedOn, { year: false })}
                </span>
              </div>
              <p className="m-0 text-sm leading-[1.55] text-[#2A2140]">{b.aiSummary.text}</p>
              <div className="flex flex-wrap gap-2">
                {b.aiSummary.reasons.map((r) => (
                  <span
                    key={r.text}
                    className={`rounded-pill bg-surface px-2.5 py-1 text-xs font-semibold ${r.kind === 'watch' ? 'text-warning-fg' : 'text-ai-ink'}`}
                  >
                    {r.kind === 'watch' ? 'Watch' : 'Why'}: {r.text}
                  </span>
                ))}
              </div>
              <span className="text-xs text-ai-ink-soft">
                Advice from {b.aiSummary.modelVersion}. It does not decide anything.
              </span>
              <AiSummaryButton code={b.code} hasSummary />
            </section>
          ) : (
            <section
              aria-label="AI summary"
              className="flex flex-wrap items-center gap-3 rounded-card border border-ai-line bg-ai-tint p-5 text-ai-ink"
            >
              <span className="mr-auto text-sm">No AI summary yet for this borrower.</span>
              <AiSummaryButton code={b.code} hasSummary={false} />
            </section>
          )}

          <section
            aria-label="Totals"
            className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3"
          >
            {(
              [
                ['Lifetime borrowed', b.totals.lifetimeBorrowed, ''],
                ['Currently owed', b.totals.currentlyOwed, ''],
                ['Pre-approved limit', b.totals.preApprovedLimit, 'text-positive-fg'],
              ] as const
            ).map(([label, amount, colour]) => (
              <div
                key={label}
                className="flex flex-col gap-2 rounded-[18px] border border-line bg-surface p-[18px]"
              >
                <span className="text-xs text-ink-muted">{label}</span>
                <span className={`font-display text-2xl font-semibold ${colour}`}>
                  {amount == null ? '—' : <Money amount={amount} compact />}
                </span>
              </div>
            ))}
          </section>

          <Card className="gap-3.5">
            <CardTitle>Loans</CardTitle>
            {b.loans.length === 0 ? (
              <p className="m-0 text-sm text-ink-muted">No loans yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm tabular-nums">
                  <thead>
                    <tr className="text-left text-xs text-ink-muted">
                      {['Loan', 'Product', 'Principal', 'Period', 'Status'].map((h) => (
                        <th
                          key={h}
                          scope="col"
                          className={`border-b border-line px-2 pt-2 pb-2.5 font-medium first:pl-0 last:pr-0 ${h === 'Principal' ? 'text-right' : ''}`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.loans.map((l) => (
                      <tr
                        key={l.code}
                        className="[&>td]:border-b [&>td]:border-line-soft [&>td]:px-2 [&>td]:py-3 [&>td:first-child]:pl-0 [&>td:last-child]:pr-0"
                      >
                        <td>
                          <Link href={`/loans/${l.code}`} className="font-semibold">
                            {l.code}
                          </Link>
                        </td>
                        <td>{l.productName}</td>
                        <td className="text-right font-semibold">
                          <Money amount={l.principal} />
                        </td>
                        <td className="text-ink-muted">{l.period}</td>
                        <td>
                          <span
                            className={`rounded-pill px-[9px] py-[3px] text-xs font-semibold whitespace-nowrap ${
                              l.status === 'ACTIVE'
                                ? 'bg-ink text-lime'
                                : l.status === 'WRITTEN_OFF'
                                  ? 'bg-danger-bg text-danger-fg'
                                  : 'bg-success-bg text-success-fg'
                            }`}
                          >
                            {l.statusLabel}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="gap-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <CardTitle className="mr-auto">Payment history</CardTitle>
              {LEGEND.filter(([key]) => used.includes(key) || key === 'ON_TIME').map(
                ([key, label]) => (
                  <span key={key} className="flex items-center gap-1.5 text-xs text-ink-muted">
                    <span className={`box-border size-3 rounded ${CELL[key]}`} />
                    {label}
                  </span>
                ),
              )}
            </div>
            {b.history.cells.length ? (
              <div
                role="img"
                aria-label={`${paidCells} instalments paid, next ${upcomingCells} upcoming. ${b.history.summary}`}
                className="grid grid-cols-[repeat(15,minmax(0,1fr))] gap-1.5"
              >
                {b.history.cells.map((cell, i) => (
                  <span key={i} className={`box-border aspect-square rounded-md ${CELL[cell]}`} />
                ))}
              </div>
            ) : null}
            <span className="text-[13px] text-ink-muted">{b.history.summary}</span>
          </Card>

          <Card className="gap-3">
            <CardTitle>Officer notes</CardTitle>
            {b.notes.length === 0 ? (
              <p className="m-0 text-sm text-ink-muted">No notes yet.</p>
            ) : null}
            {b.notes.map((n) => (
              <div key={n.id} className="flex flex-col gap-1.5 rounded-panel bg-ground p-3.5">
                <span className="text-sm leading-normal whitespace-pre-line">{n.body}</span>
                <span className="text-xs text-ink-muted">
                  {n.author ?? 'Staff'} · {formatDate(n.createdOn)}
                </span>
              </div>
            ))}
            <NoteForm code={b.code} />
          </Card>
        </div>
      </div>
    </>
  );
}
