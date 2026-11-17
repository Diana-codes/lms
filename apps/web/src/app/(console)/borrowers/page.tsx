import {
  Avatar,
  BorrowersIcon,
  Card,
  chipClasses,
  EmptyState,
  Pill,
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
import type { BorrowerListItem, Paged } from '@/lib/types';

export const metadata: Metadata = { title: 'Borrowers' };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function BorrowersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = one(sp.q)?.trim() || undefined;
  const mine = one(sp.mine) === 'true' ? 'true' : undefined;
  // "No officer" and "Assigned to me" exclude each other.
  const unassigned = !mine && one(sp.unassigned) === 'true' ? 'true' : undefined;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const res = await serverApi<Paged<BorrowerListItem>>(
    listHref('/borrowers', { q, mine, unassigned, page }),
  );
  const anyFilter = Boolean(q || mine || unassigned);

  return (
    <>
      <PageHeader
        eyebrow={
          res.ok
            ? `${count(res.data.total)} ${res.data.total === 1 ? 'borrower' : 'borrowers'}`
            : undefined
        }
        title="Borrowers"
      />
      <div className="flex flex-wrap items-center gap-2">
        <SearchForm
          action="/borrowers"
          q={q}
          placeholder="Search by name, business or borrower number"
          keep={{ mine, unassigned }}
        />
        <Link
          href={listHref('/borrowers', { q, mine: mine ? undefined : 'true' })}
          className={chipClasses(Boolean(mine))}
          aria-current={mine ? 'true' : undefined}
        >
          Assigned to me
        </Link>
        <Link
          href={listHref('/borrowers', { q, unassigned: unassigned ? undefined : 'true' })}
          className={chipClasses(Boolean(unassigned))}
          aria-current={unassigned ? 'true' : undefined}
        >
          No officer
        </Link>
        {anyFilter ? (
          <Link href="/borrowers" className="px-2.5 text-[13px] font-semibold">
            Clear filters
          </Link>
        ) : null}
      </div>

      {!res.ok ? (
        <EmptyState icon={<WarningIcon />} title="Couldn’t load borrowers">
          The server didn’t answer. Reload the page to try again.
        </EmptyState>
      ) : res.data.items.length === 0 ? (
        <EmptyState
          icon={<BorrowersIcon size={22} />}
          title={anyFilter ? 'No borrowers match' : 'No borrowers yet'}
        >
          {anyFilter
            ? 'Try a different search, or clear the filters.'
            : 'Borrowers are added with their first application, or sign up in the app.'}
        </EmptyState>
      ) : (
        <Card className="gap-3">
          <Table minWidth={820}>
            <thead>
              <tr>
                <Th>Borrower</Th>
                <Th>Phone</Th>
                <Th>Location</Th>
                <Th>KYC</Th>
                <Th numeric>Score</Th>
                <Th numeric>Active loans</Th>
                <Th>Officer</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.map((b) => (
                <tr key={b.code}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={b.name} />
                      <div className="flex flex-col">
                        <Link href={`/borrowers/${b.code}`} className="font-semibold">
                          {b.name}
                        </Link>
                        <span className="text-xs text-ink-muted">
                          {b.code}
                          {b.source === 'APP' ? ' · Signed up in the app' : ''}
                          {b.businessName && b.businessName !== b.name
                            ? ` · ${b.businessName}`
                            : ''}
                        </span>
                      </div>
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums">{b.phone}</Td>
                  <Td className="text-ink-soft">{b.location || '—'}</Td>
                  <Td>
                    <Pill
                      tone={
                        b.kycStatus === 'VERIFIED'
                          ? 'success'
                          : b.kycStatus === 'PENDING'
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {b.kycStatus === 'VERIFIED'
                        ? 'Verified'
                        : b.kycStatus === 'PENDING'
                          ? 'Pending'
                          : 'Needs attention'}
                    </Pill>
                  </Td>
                  <Td numeric className="font-normal">
                    {b.score ?? '—'}
                  </Td>
                  <Td numeric>{b.activeLoans}</Td>
                  <Td className="text-ink-soft">
                    {b.officerName ?? (b.source === 'APP' ? 'Needs an officer' : '—')}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={res.data.page}
            pages={res.data.pages}
            total={res.data.total}
            noun="borrower"
            href={(p) => listHref('/borrowers', { q, mine, unassigned, page: p })}
          />
        </Card>
      )}
    </>
  );
}
