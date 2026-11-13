import { DPD_BUCKET_LABELS, DPD_BUCKETS, type DpdBucket, formatDate } from '@kora/core';
import {
  Card,
  chipClasses,
  EmptyState,
  LoansIcon,
  Money,
  Pill,
  type PillTone,
  Table,
  Td,
  Th,
  WarningIcon,
} from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { listHref, Pagination, SearchForm } from '@/components/list-tools';
import { PageHeader } from '@/components/page-header';
import { count } from '@/lib/format';
import { serverApi } from '@/lib/server-api';
import type { LoanList, LoanListItem } from '@/lib/types';

export const metadata: Metadata = { title: 'Loans' };

const BUCKET_TONE: Record<DpdBucket, PillTone> = {
  CURRENT: 'success',
  DPD_1_30: 'neutral',
  DPD_31_90: 'warning',
  DPD_90_PLUS: 'danger',
};

function StatusPill({ loan }: { loan: LoanListItem }) {
  if (loan.status === 'REPAID') return <Pill tone="success">Repaid</Pill>;
  if (loan.status === 'WRITTEN_OFF') return <Pill tone="danger">Written off</Pill>;
  if (loan.status === 'PENDING_DISBURSEMENT') return <Pill tone="info">Pending</Pill>;
  const bucket = loan.bucket ?? 'CURRENT';
  return (
    <Pill tone={BUCKET_TONE[bucket]}>
      {loan.dpd > 0 ? `${loan.dpd} ${loan.dpd === 1 ? 'day' : 'days'} late` : 'On track'}
    </Pill>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LoansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = one(sp.q)?.trim() || undefined;
  const bucket = DPD_BUCKETS.find((b) => b === one(sp.bucket));
  const status = one(sp.status) === 'REPAID' ? 'REPAID' : undefined;
  const mine = one(sp.mine) === 'true' ? 'true' : undefined;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const filters = { q, bucket, status, mine };

  const res = await serverApi<LoanList>(listHref('/loans', { ...filters, page }));
  const href = (extra: Record<string, string | number | undefined>) =>
    listHref('/loans', { ...filters, page: 1, ...extra });
  const anyFilter = Boolean(q || bucket || status || mine);

  return (
    <>
      <PageHeader
        eyebrow={
          res.ok ? (
            <>
              {count(res.data.total)} {res.data.total === 1 ? 'loan' : 'loans'} ·{' '}
              <Money amount={res.data.outstanding} compact /> outstanding
            </>
          ) : undefined
        }
        title="Loans"
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchForm
          action="/loans"
          q={q}
          placeholder="Search by borrower or loan number"
          keep={{ bucket, status, mine }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        <Link
          href={href({ bucket: undefined, status: undefined })}
          className={chipClasses(!bucket && !status)}
          aria-current={!bucket && !status ? 'true' : undefined}
        >
          All loans
        </Link>
        {DPD_BUCKETS.map((b) => (
          <Link
            key={b}
            href={href({ bucket: b, status: undefined })}
            className={chipClasses(bucket === b)}
            aria-current={bucket === b ? 'true' : undefined}
          >
            {DPD_BUCKET_LABELS[b]}
          </Link>
        ))}
        <Link
          href={href({ status: 'REPAID', bucket: undefined })}
          className={chipClasses(status === 'REPAID')}
          aria-current={status === 'REPAID' ? 'true' : undefined}
        >
          Repaid
        </Link>
        <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
        <Link
          href={href({ mine: mine ? undefined : 'true' })}
          className={chipClasses(Boolean(mine))}
          aria-current={mine ? 'true' : undefined}
        >
          Assigned to me
        </Link>
        {anyFilter ? (
          <Link href="/loans" className="px-2.5 text-[13px] font-semibold">
            Clear filters
          </Link>
        ) : null}
      </div>

      {!res.ok ? (
        <EmptyState icon={<WarningIcon />} title="Couldn’t load loans">
          The server didn’t answer. Reload the page to try again.
        </EmptyState>
      ) : res.data.items.length === 0 ? (
        <EmptyState
          icon={<LoansIcon size={22} />}
          title={anyFilter ? 'No loans match these filters' : 'No loans yet'}
        >
          {anyFilter
            ? 'Try a different search, or clear the filters to see everything.'
            : 'Loans appear here once an approved application is disbursed.'}
        </EmptyState>
      ) : (
        <Card className="gap-3">
          <Table minWidth={860}>
            <thead>
              <tr>
                <Th>Loan</Th>
                <Th>Product</Th>
                <Th numeric>Principal</Th>
                <Th numeric>Outstanding</Th>
                <Th>Next due</Th>
                <Th>Status</Th>
                <Th>Officer</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.map((loan) => (
                <tr key={loan.code}>
                  <Td>
                    <div className="flex flex-col">
                      <Link href={`/loans/${loan.code}`} className="font-semibold">
                        {loan.code}
                      </Link>
                      <span className="text-xs text-ink-muted">{loan.borrowerName}</span>
                    </div>
                  </Td>
                  <Td className="text-ink-soft">{loan.productName}</Td>
                  <Td numeric className="font-normal">
                    <Money amount={loan.principal} bare />
                  </Td>
                  <Td numeric>
                    <Money amount={loan.outstanding} bare />
                  </Td>
                  <Td className="whitespace-nowrap text-ink-soft">
                    {loan.nextDue ? formatDate(loan.nextDue) : '—'}
                  </Td>
                  <Td>
                    <StatusPill loan={loan} />
                  </Td>
                  <Td className="text-ink-soft">{loan.officerName ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="m-0 text-xs text-ink-muted">Amounts are in RWF.</p>
          <Pagination
            page={res.data.page}
            pages={res.data.pages}
            total={res.data.total}
            noun="loan"
            href={(p) => listHref('/loans', { ...filters, page: p })}
          />
        </Card>
      )}
    </>
  );
}
