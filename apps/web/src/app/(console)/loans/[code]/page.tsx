import {
  describePenalty,
  describeRate,
  formatBps,
  formatDate,
  FREQUENCY_LABELS,
  INTEREST_METHOD_LABELS,
} from '@kora/core';
import { buttonClasses, Card, EmptyState, LoansIcon, Money, WarningIcon } from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumb } from '@/components/list-tools';
import { dateTime } from '@/lib/format';
import { serverApi } from '@/lib/server-api';
import type { LoanDetail, Me } from '@/lib/types';
import { LoanActions, RestructureBanner } from './loan-actions';
import { MomoRequestButton, PendingMomoBanner } from './momo-actions';
import { ScheduleTable } from './schedule-table';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  return { title: (await params).code };
}

const ACTIVITY_DOT: Record<LoanDetail['activity'][number]['kind'], string> = {
  payment: 'bg-lime-deep',
  system: 'bg-[#A7ADA3]',
  disbursement: 'bg-forest',
  restructure: 'bg-amber',
  contact: 'bg-[#3B6FC2]',
};

function Term({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="m-0 font-semibold">{children}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="m-0 text-right font-semibold">{children}</dd>
    </div>
  );
}

export default async function LoanPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [res, me] = await Promise.all([
    serverApi<LoanDetail>(`/loans/${encodeURIComponent(code)}`),
    serverApi<Me>('/auth/me'),
  ]);

  if (!res.ok || !me.ok) {
    const missing = !res.ok && (res.status === 404 || res.status === 400);
    return (
      <>
        <Breadcrumb parent="Loans" parentHref="/loans" current={code} />
        <EmptyState
          icon={missing ? <LoansIcon size={22} /> : <WarningIcon />}
          title={missing ? 'No loan with that number' : 'Couldn’t load this loan'}
          action={
            <Link href="/loans" className={buttonClasses({ variant: 'secondary' })}>
              Back to loans
            </Link>
          }
        >
          {missing
            ? `Nothing matches ${code}. Check the number and try again.`
            : 'The server didn’t answer. Reload the page to try again.'}
        </EmptyState>
      </>
    );
  }

  const loan = res.data;
  const { borrower, terms, figures, next } = loan;
  const late = loan.dpd > 0;
  const closed = loan.status !== 'ACTIVE';
  const ring = Math.round(figures.repaidPercent * 3.6);
  const subtitle = [
    loan.productName,
    [borrower.businessName, borrower.sector].filter(Boolean).join(', '),
    loan.officerName ? `Officer: ${loan.officerName}` : null,
  ].filter(Boolean);

  return (
    <>
      <Breadcrumb parent="Loans" parentHref="/loans" current={loan.code} />

      <header className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden="true"
          className="flex size-14 flex-none items-center justify-center rounded-2xl bg-avatar-bg font-display text-xl font-semibold text-forest"
        >
          {borrower.initials}
        </span>
        <div className="mr-auto flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="m-0 font-display text-[28px] leading-tight font-semibold tracking-[-0.02em]">
              {borrower.name}
            </h1>
            <span
              className={`flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-semibold ${
                late
                  ? 'bg-danger-bg text-danger-fg'
                  : closed
                    ? 'bg-neutral-bg text-neutral-fg'
                    : 'bg-success-bg text-success-fg'
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${late ? 'bg-rust' : closed ? 'bg-ink-muted' : 'bg-[#3E7A07]'}`}
              />
              {loan.statusLabel}
            </span>
          </div>
          <span className="text-sm text-ink-muted">{subtitle.join(' · ')}</span>
        </div>
        <MomoRequestButton loan={loan} />
        <LoanActions loan={loan} />
      </header>

      <PendingMomoBanner loan={loan} />

      {loan.pendingRestructure ? <RestructureBanner loan={loan} me={me.data} /> : null}

      <div className="flex flex-wrap items-start gap-4">
        <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-4">
          <section className="flex flex-wrap items-center gap-7 rounded-[22px] bg-forest p-[26px] text-white">
            <div
              role="img"
              aria-label={`${figures.repaidPercent} percent of principal repaid`}
              className="flex size-[132px] flex-none items-center justify-center rounded-full"
              style={{
                background: `conic-gradient(var(--color-lime) 0deg ${ring}deg, rgba(255,255,255,0.14) ${ring}deg 360deg)`,
              }}
            >
              <div className="flex size-[104px] flex-col items-center justify-center rounded-full bg-forest">
                <span className="font-display text-[26px] font-semibold">
                  {figures.repaidPercent}%
                </span>
                <span className="text-[11px] text-forest-muted">repaid</span>
              </div>
            </div>
            <dl className="m-0 grid flex-[1_1_360px] grid-cols-2 gap-x-7 gap-y-5">
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-forest-muted">Outstanding principal</dt>
                <dd className="m-0 font-display text-[26px] leading-tight font-semibold">
                  <Money amount={figures.outstandingPrincipal} />
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-forest-muted">
                  {next
                    ? `Next instalment · ${formatDate(next.dueDate, { year: false })}`
                    : 'Next instalment'}
                </dt>
                <dd className="m-0 font-display text-[26px] leading-tight font-semibold text-lime">
                  {next ? <Money amount={next.amount} /> : 'None'}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-forest-muted">Total repaid</dt>
                <dd className="m-0 text-base font-semibold">
                  <Money amount={figures.totalRepaid} />
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-forest-muted">Instalments</dt>
                <dd className="m-0 text-base font-semibold">
                  {figures.paidCount} of {figures.instalmentCount} paid · {figures.lateCount} late
                </dd>
              </div>
            </dl>
          </section>

          <ScheduleTable
            rows={loan.schedule}
            subtitle={`${INTEREST_METHOD_LABELS[terms.interestMethod]} · ${FREQUENCY_LABELS[terms.frequency].toLowerCase()}`}
          />
        </div>

        <aside className="flex min-w-0 flex-[1_1_300px] flex-col gap-4">
          <Card className="gap-3.5 p-[22px]">
            <h2 className="m-0 font-display text-base font-semibold">Loan terms</h2>
            <dl className="m-0 grid grid-cols-2 gap-3.5 text-sm">
              <Term label="Principal">
                <Money amount={terms.principal} />
              </Term>
              <Term label="Interest">{describeRate(terms)}</Term>
              <Term label="Term">
                {terms.termMonths} months · {FREQUENCY_LABELS[terms.frequency].toLowerCase()}
              </Term>
              {terms.aprBps != null ? <Term label="APR">{formatBps(terms.aprBps, 2)}</Term> : null}
              {terms.netDisbursed != null ? (
                <Term label="Paid out">
                  <Money amount={terms.netDisbursed} />
                </Term>
              ) : null}
              <Term label="Disbursed">
                {terms.disbursedOn ? formatDate(terms.disbursedOn) : 'Not yet'}
              </Term>
              <Term label="Channel">{terms.channel ?? '—'}</Term>
              <Term label="Collateral">{terms.collateral ?? 'None recorded'}</Term>
              <Term label="Late charges">{describePenalty(terms.penalty)}</Term>
              {terms.fees.length ? (
                <Term label="Fees">
                  {terms.fees
                    .map(
                      (f) =>
                        (f.basis === 'PERCENT'
                          ? `${f.name} ${formatBps(f.value, f.value % 100 ? 2 : 0)}`
                          : `${f.name} RWF ${f.value.toLocaleString('en-US')}`) +
                        (f.vat ? ' + VAT' : '') +
                        (f.thirdParty ? ' (third party)' : ''),
                    )
                    .join(' · ')}
                </Term>
              ) : null}
            </dl>
          </Card>

          {figures.payoff ? (
            <Card className="gap-3 p-[22px]">
              <h2 className="m-0 font-display text-base font-semibold">Pay off today</h2>
              <p className="m-0 font-display text-2xl font-semibold tabular-nums">
                <Money amount={figures.payoff.total} />
              </p>
              <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt className="text-ink-muted">Principal</dt>
                <dd className="m-0 text-right tabular-nums">
                  <Money amount={figures.payoff.principal} />
                </dd>
                <dt className="text-ink-muted">Interest</dt>
                <dd className="m-0 text-right tabular-nums">
                  <Money amount={figures.payoff.interest} />
                </dd>
                {figures.payoff.fees !== '0' ? (
                  <>
                    <dt className="text-ink-muted">Fees</dt>
                    <dd className="m-0 text-right tabular-nums">
                      <Money amount={figures.payoff.fees} />
                    </dd>
                  </>
                ) : null}
                {figures.payoff.penalties !== '0' ? (
                  <>
                    <dt className="text-ink-muted">Late charges</dt>
                    <dd className="m-0 text-right tabular-nums">
                      <Money amount={figures.payoff.penalties} />
                    </dd>
                  </>
                ) : null}
              </dl>
              {figures.payoff.waived !== '0' ? (
                <p className="m-0 text-[13px] text-ink-muted">
                  <Money amount={figures.payoff.waived} /> less than the schedule would charge.
                </p>
              ) : null}
            </Card>
          ) : null}

          <Card className="gap-3.5 p-[22px]">
            <h2 className="m-0 font-display text-base font-semibold">Borrower</h2>
            <dl className="m-0 flex flex-col gap-2.5 text-sm">
              <Row label="Credit score">
                {borrower.score
                  ? `${borrower.score.value} · ${borrower.score.label}`
                  : 'Not scored'}
              </Row>
              <Row label="KYC">
                <span
                  className={
                    borrower.kycStatus === 'VERIFIED' ? 'text-positive-fg' : 'text-caution-fg'
                  }
                >
                  {borrower.kycStatus === 'VERIFIED'
                    ? 'Verified'
                    : borrower.kycStatus === 'PENDING'
                      ? 'Pending'
                      : 'Needs attention'}
                </span>
              </Row>
              <Row label="Previous loans">
                {borrower.previousLoans === 0
                  ? 'None'
                  : borrower.previousLoansRepaid === borrower.previousLoans
                    ? `${borrower.previousLoans} · fully repaid`
                    : `${borrower.previousLoans} · ${borrower.previousLoansRepaid} repaid`}
              </Row>
              <Row label="Phone">{borrower.phone}</Row>
            </dl>
            <Link href={`/borrowers/${borrower.code}`} className="text-sm font-semibold">
              Open borrower profile
            </Link>
          </Card>

          <Card className="gap-1 p-[22px]">
            <h2 className="m-0 mb-2.5 font-display text-base font-semibold">Activity</h2>
            {loan.activity.length === 0 ? (
              <p className="m-0 text-sm text-ink-muted">Nothing yet.</p>
            ) : null}
            <ol className="m-0 list-none p-0">
              {loan.activity.map((event, i) => (
                <li key={`${event.at}-${i}`} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span className={`mt-1 size-2.5 rounded-full ${ACTIVITY_DOT[event.kind]}`} />
                    <span className="min-h-7 w-0.5 flex-1 bg-neutral-bg" />
                  </div>
                  <div className="flex flex-col gap-0.5 pb-3.5">
                    <span className="text-sm font-medium">{event.title}</span>
                    <span className="text-xs text-ink-muted">
                      {dateTime(event.at)}
                      {event.by ? ` · ${event.by}` : ''}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </aside>
      </div>
    </>
  );
}
