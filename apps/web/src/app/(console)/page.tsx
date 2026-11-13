import { DPD_BUCKET_LABELS, DPD_BUCKETS, type DpdBucket, formatBps } from '@kora/core';
import {
  Avatar,
  buttonClasses,
  Card,
  CardTitle,
  EmptyState,
  Money,
  Pill,
  type PillTone,
  PlusIcon,
  ProgressBar,
  StatTile,
  Table,
  Td,
  Th,
  WarningIcon,
} from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { GlobalSearch, NotificationBell } from '@/components/header-tools';
import { PageHeader } from '@/components/page-header';
import { count, longDate } from '@/lib/format';
import { serverApi } from '@/lib/server-api';
import type { NotificationList, Overview } from '@/lib/types';
import { OverviewChart } from './overview-chart';
import { RemindersButton } from './reminders-button';

export const metadata: Metadata = { title: 'Overview' };

const BUCKET_COLOUR: Record<DpdBucket, string> = {
  CURRENT: 'bg-forest',
  DPD_1_30: 'bg-lime-deep',
  DPD_31_90: 'bg-amber',
  DPD_90_PLUS: 'bg-rust',
};

const STATUS_TONE: Record<string, PillTone> = {
  Approved: 'success',
  Disbursed: 'success',
  'In review': 'info',
  New: 'info',
  'Docs needed': 'warning',
  Declined: 'danger',
  Withdrawn: 'neutral',
};

export default async function OverviewPage() {
  const [overview, notifications] = await Promise.all([
    serverApi<Overview>('/dashboard/overview'),
    serverApi<NotificationList>('/notifications'),
  ]);
  const now = Date.now();

  if (!overview.ok) {
    return (
      <>
        <PageHeader title="Portfolio overview" />
        <EmptyState icon={<WarningIcon />} title="Couldn’t load the portfolio">
          The server didn’t answer. Reload the page to try again.
        </EmptyState>
      </>
    );
  }

  const { metrics, series, buckets, recentApplications, dueThisWeek, asOf, scope } = overview.data;
  const late = buckets.DPD_31_90;
  const change = metrics.portfolioChangeBps;

  return (
    <>
      <PageHeader
        eyebrow={longDate(asOf)}
        title={scope === 'mine' ? 'My portfolio' : 'Portfolio overview'}
      >
        <GlobalSearch />
        <NotificationBell
          initial={notifications.ok ? notifications.data : { unread: 0, items: [] }}
          now={now}
        />
        <Link href="/applications?new=1" className={buttonClasses()}>
          <PlusIcon size={16} />
          New loan
        </Link>
      </PageHeader>

      <section
        aria-label="Key metrics"
        className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4"
      >
        <StatTile
          tone="forest"
          label="Active portfolio"
          value={<Money amount={metrics.activePortfolio} compact />}
        >
          <Pill tone="lime" className="self-start">
            {change == null
              ? `${count(metrics.activeLoans)} active loans`
              : `${change >= 0 ? '+' : '−'}${formatBps(Math.abs(change))} vs last month`}
          </Pill>
        </StatTile>
        <StatTile
          label="Disbursed this month"
          value={<Money amount={metrics.disbursedThisMonth} compact />}
        >
          <span className="text-[13px] font-medium text-positive-fg">
            {count(metrics.loansThisMonth)} {metrics.loansThisMonth === 1 ? 'loan' : 'loans'} ·{' '}
            {metrics.loansVsLastMonth >= 0 ? '+' : '−'}
            {Math.abs(metrics.loansVsLastMonth)} vs {metrics.lastMonthLabel}
          </span>
        </StatTile>
        <StatTile
          label="Collection rate"
          value={metrics.collectionRateBps == null ? '—' : formatBps(metrics.collectionRateBps)}
        >
          {metrics.collectionRateBps == null ? (
            <span className="text-[13px] text-ink-muted">Nothing has fallen due this month</span>
          ) : (
            <ProgressBar
              value={metrics.collectionRateBps / 100}
              label="Collection rate this month"
            />
          )}
        </StatTile>
        <StatTile label="Portfolio at risk (30+ days)" value={formatBps(metrics.par30Bps)}>
          <span className="text-[13px] font-medium text-caution-fg">
            {count(metrics.loansOver30)} {metrics.loansOver30 === 1 ? 'loan' : 'loans'}
          </span>
        </StatTile>
      </section>

      <section className="flex flex-wrap gap-4">
        <Card className="flex-[2_1_520px] gap-5">
          <OverviewChart series={series} />
        </Card>

        <Card className="flex-[1_1_300px] gap-[18px]">
          <CardTitle>Repayment health</CardTitle>
          <div
            role="img"
            aria-label={`Loans by days past due: ${DPD_BUCKETS.map((b) => `${DPD_BUCKET_LABELS[b]} ${buckets[b]}`).join(', ')}`}
            className="flex h-3.5 gap-0.5 overflow-hidden rounded-pill"
          >
            {DPD_BUCKETS.map((bucket) =>
              buckets[bucket] ? (
                <div
                  key={bucket}
                  className={BUCKET_COLOUR[bucket]}
                  style={{ flex: buckets[bucket] }}
                />
              ) : null,
            )}
          </div>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {DPD_BUCKETS.map((bucket) => (
              <li key={bucket}>
                <Link
                  href={`/loans?bucket=${bucket}`}
                  className="flex items-center gap-2.5 text-sm text-ink no-underline hover:underline"
                >
                  <span className={`size-2.5 rounded-[3px] ${BUCKET_COLOUR[bucket]}`} />
                  {DPD_BUCKET_LABELS[bucket]}
                  <span className="ml-auto font-semibold tabular-nums">
                    {count(buckets[bucket])}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {late > 0 ? (
            <Card tone="caution" compact className="mt-auto flex-row items-start gap-2.5">
              <WarningIcon className="mt-px flex-none text-caution-fg" />
              <span className="text-[13px] leading-snug">
                {count(late)} {late === 1 ? 'loan is' : 'loans are'} 31–90 days late.{' '}
                <Link href="/loans?bucket=DPD_31_90" className="font-semibold text-caution-ink">
                  Review them
                </Link>
              </span>
            </Card>
          ) : null}
        </Card>
      </section>

      <section className="flex flex-wrap gap-4">
        <Card className="flex-[2_1_520px]">
          <div className="flex items-center">
            <CardTitle className="mr-auto">Recent applications</CardTitle>
            <Link href="/applications" className="text-sm font-semibold">
              View pipeline
            </Link>
          </div>
          {recentApplications.length === 0 ? (
            <p className="m-0 py-6 text-center text-sm text-ink-muted">No applications yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Borrower</Th>
                  <Th>Product</Th>
                  <Th numeric>Amount</Th>
                  <Th>Credit score</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {recentApplications.map((a) => (
                  <tr key={a.code}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={a.name} />
                        <div className="flex flex-col">
                          <Link
                            href={`/applications?open=${a.code}`}
                            className="font-medium text-ink no-underline hover:underline"
                          >
                            {a.name}
                          </Link>
                          <span className="text-xs text-ink-muted">{a.code}</span>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-ink-soft">{a.productName}</Td>
                    <Td numeric>
                      <Money amount={a.amount} />
                    </Td>
                    <Td className="tabular-nums">{a.score ?? '—'}</Td>
                    <Td>
                      <Pill tone={STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</Pill>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card className="flex-[1_1_300px] gap-3.5">
          <CardTitle>Due this week</CardTitle>
          {dueThisWeek.items.length === 0 ? (
            <p className="m-0 py-6 text-center text-sm text-ink-muted">
              Nothing falls due in the next 7 days.
            </p>
          ) : null}
          {dueThisWeek.items.map((d) => (
            <Link
              key={`${d.loanCode}-${d.day}`}
              href={`/loans/${d.loanCode}`}
              className="flex items-center gap-3 border-b border-line-soft py-2.5 text-ink no-underline hover:bg-ground"
            >
              <div className="flex size-11 flex-none flex-col items-center justify-center rounded-control bg-ground">
                <span className="text-[10px] text-ink-muted uppercase">{d.weekday}</span>
                <span className="font-display text-base leading-none font-semibold">{d.day}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{d.name}</span>
                <span className="text-xs text-ink-muted">{d.note}</span>
              </div>
              <Money amount={d.amount} className="ml-auto text-sm font-semibold" />
            </Link>
          ))}
          {dueThisWeek.total > dueThisWeek.items.length ? (
            <span className="text-[13px] text-ink-muted">
              and {count(dueThisWeek.total - dueThisWeek.items.length)} more this week
            </span>
          ) : null}
          <div className="mt-auto">
            <RemindersButton dueCount={dueThisWeek.total} />
          </div>
        </Card>
      </section>
    </>
  );
}
