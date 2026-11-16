import { FINANCE_ROLES, formatDate } from '@kora/core';
import { Card, CardTitle, EmptyState, Money, Pill, Table, Td, Th, WarningIcon } from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Breadcrumb } from '@/components/list-tools';
import { PageHeader } from '@/components/page-header';
import { dateTime } from '@/lib/format';
import { serverApi } from '@/lib/server-api';
import type { Me } from '@/lib/types';
import { SubmissionActions } from '../bureau-actions';
import { type BureauSubmissionRow, monthLabel, STATUS } from '../types';

export const metadata: Metadata = { title: 'Credit bureau file' };

export default async function BureauFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, res] = await Promise.all([
    serverApi<Me>('/auth/me'),
    serverApi<BureauSubmissionRow>(`/bureau/submissions/${encodeURIComponent(id)}`),
  ]);
  if (!me.ok) redirect('/login');
  if (!res.ok) {
    return (
      <EmptyState icon={<WarningIcon />} title="Couldn’t load this file">
        {res.status === 404 ? 'There is no such file.' : 'Reload the page to try again.'}{' '}
        <Link href="/bureau">Back to credit bureau</Link>
      </EmptyState>
    );
  }
  const r = res.data;
  const byLoan = new Map<string, string[]>();
  for (const p of r.excluded ?? []) {
    byLoan.set(p.accountNumber, [...(byLoan.get(p.accountNumber) ?? []), p.message]);
  }

  return (
    <>
      <Breadcrumb parent="Credit bureau" parentHref="/bureau" current={monthLabel(r.month)} />
      <PageHeader
        eyebrow={`Member code ${r.lenderCode} · ${r.formatVersion}`}
        title={`${monthLabel(r.month)}${r.sequence > 1 ? ` · correction ${r.sequence - 1}` : ''}`}
      >
        <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card className="gap-3">
          <CardTitle>File</CardTitle>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-ink-muted">Period end</dt>
            <dd className="m-0">{formatDate(r.periodEnd)}</dd>
            <dt className="text-ink-muted">Loans reported</dt>
            <dd className="m-0 tabular-nums">{r.recordCount}</dd>
            <dt className="text-ink-muted">Balance reported</dt>
            <dd className="m-0">
              <Money amount={r.totalBalance} />
            </dd>
            <dt className="text-ink-muted">Of which in arrears</dt>
            <dd className="m-0">
              <Money amount={r.totalArrears} />
            </dd>
            <dt className="text-ink-muted">Built</dt>
            <dd className="m-0">{dateTime(r.generatedAt)}</dd>
            <dt className="text-ink-muted">SHA-256</dt>
            <dd className="m-0 font-mono text-xs break-all">{r.fileSha256}</dd>
            {r.submittedAt ? (
              <>
                <dt className="text-ink-muted">Sent</dt>
                <dd className="m-0">
                  {dateTime(r.submittedAt)} · ref. {r.bureauReference}
                </dd>
              </>
            ) : null}
            {r.respondedAt ? (
              <>
                <dt className="text-ink-muted">Bureau’s answer</dt>
                <dd className="m-0">
                  {STATUS[r.status].label}
                  {r.rejectedCount ? ` · ${r.rejectedCount} records rejected` : ''}
                  {r.responseNote ? ` · ${r.responseNote}` : ''}
                </dd>
              </>
            ) : null}
          </dl>
        </Card>
        <Card className="gap-3">
          <CardTitle>Send it</CardTitle>
          <SubmissionActions
            row={r}
            canAct={(FINANCE_ROLES as readonly string[]).includes(me.data.role)}
          />
          {r.status === 'REJECTED' ? (
            <p className="m-0 text-sm">
              Fix the records the bureau named, then build the month again from{' '}
              <Link href="/bureau">Credit bureau</Link>: it becomes a correction file.
            </p>
          ) : null}
        </Card>
      </div>

      <h2 className="m-0 font-display text-lg font-semibold">
        Left out of the file ({byLoan.size})
      </h2>
      {byLoan.size === 0 ? (
        <p className="m-0 text-sm text-ink-muted">Every loan open in the month is in the file.</p>
      ) : (
        <Card>
          <p className="m-0 mb-2 text-sm text-ink-soft">
            Fix these on the borrower’s profile (national ID, RDB code or phone), then build the
            month again.
          </p>
          <Table minWidth={520}>
            <thead>
              <tr>
                <Th>Loan</Th>
                <Th>What is missing</Th>
              </tr>
            </thead>
            <tbody>
              {[...byLoan].map(([loan, problems]) => (
                <tr key={loan}>
                  <Td>
                    <Link href={`/loans/${loan}`} className="font-semibold">
                      {loan}
                    </Link>
                  </Td>
                  <Td>{problems.join('; ')}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
