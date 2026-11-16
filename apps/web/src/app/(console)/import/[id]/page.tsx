import { formatDate } from '@kora/core';
import { Card, CardTitle, EmptyState, Money, Pill, Table, Td, Th, WarningIcon } from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Breadcrumb } from '@/components/list-tools';
import { PageHeader } from '@/components/page-header';
import { dateTime } from '@/lib/format';
import { serverApi } from '@/lib/server-api';
import type { Me } from '@/lib/types';
import { BatchActions } from '../import-actions';
import { STATUS } from '../status';

export const metadata: Metadata = { title: 'Loan book upload' };

interface Batch {
  id: string;
  fileName: string;
  asOf: string;
  status: keyof typeof STATUS;
  rowCount: number;
  totalOutstanding: string;
  problems: Array<{ line: number; errors: string[] }>;
  rows: Array<{
    line: number;
    loanRef: string;
    borrowerName: string;
    productCode: string;
    outstandingPrincipal: string;
    arrearsPrincipal: string;
    nextDueDate: string | null;
    remainingInstalments: number;
  }>;
  createdBy: string | null;
  createdById: string;
  createdAt: string;
  importedBy: string | null;
  importedById: string | null;
  importedAt: string | null;
  signedOffBy: string | null;
  signedOffAt: string | null;
}
interface Reconciliation {
  loans: number;
  matched: number;
  sheetTotal: string;
  ledgerTotal: string;
  allMatch: boolean;
  items: Array<{
    line: number;
    loanRef: string;
    loanCode: string | null;
    borrowerName: string;
    sheetOutstanding: string;
    openingPrincipal: string;
    currentPrincipal: string;
    matches: boolean;
  }>;
}

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [me, res] = await Promise.all([
    serverApi<Me>('/auth/me'),
    serverApi<Batch>(`/migration/batches/${encodeURIComponent(id)}`),
  ]);
  if (!me.ok) redirect('/login');
  if (!res.ok) {
    return (
      <EmptyState icon={<WarningIcon />} title="Couldn’t load this upload">
        <Link href="/import">Back to Import loan book</Link>
      </EmptyState>
    );
  }
  const b = res.data;
  const imported = b.status === 'IMPORTED' || b.status === 'SIGNED_OFF';
  const rec = imported
    ? await serverApi<Reconciliation>(`/migration/batches/${encodeURIComponent(id)}/reconciliation`)
    : null;
  const role = me.data.role;
  const canImport = role === 'ADMIN' || role === 'MANAGER';
  const canSignOff =
    (role === 'ADMIN' || role === 'MANAGER' || role === 'ACCOUNTANT') &&
    me.data.id !== b.importedById &&
    me.data.id !== b.createdById;

  return (
    <>
      <Breadcrumb parent="Import loan book" parentHref="/import" current={b.fileName} />
      <PageHeader
        eyebrow={`Cut-over ${formatDate(b.asOf)} · uploaded by ${b.createdBy ?? '—'}, ${dateTime(b.createdAt)}`}
        title={b.fileName}
      >
        <Pill tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Pill>
      </PageHeader>

      <Card className="gap-3">
        <dl className="m-0 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-ink-muted">Rows</dt>
            <dd className="m-0 font-semibold">{b.rowCount}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Rows with problems</dt>
            <dd className="m-0 font-semibold">{b.problems.length}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Outstanding (clean rows)</dt>
            <dd className="m-0 font-semibold">
              <Money amount={b.totalOutstanding} />
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Signed off</dt>
            <dd className="m-0 font-semibold">
              {b.signedOffAt ? `${b.signedOffBy ?? '—'}, ${dateTime(b.signedOffAt)}` : '—'}
            </dd>
          </div>
        </dl>
        <BatchActions
          id={b.id}
          status={b.status}
          canImport={canImport}
          canSignOff={canSignOff}
          allMatch={rec?.ok ? rec.data.allMatch : false}
        />
        {b.status === 'IMPORTED' && !canSignOff ? (
          <p className="m-0 text-sm text-ink-muted">
            Waiting for someone other than the person who imported it to check and sign off.
          </p>
        ) : null}
      </Card>

      {b.problems.length ? (
        <Card className="gap-3">
          <CardTitle>Fix these in the spreadsheet, then upload it again</CardTitle>
          <Table minWidth={560}>
            <thead>
              <tr>
                <Th>Line</Th>
                <Th>Problems</Th>
              </tr>
            </thead>
            <tbody>
              {b.problems.map((p) => (
                <tr key={p.line}>
                  <Td className="font-semibold tabular-nums">{p.line}</Td>
                  <Td>
                    <ul className="m-0 pl-4 text-sm">
                      {p.errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}

      {rec?.ok ? (
        <Card className="gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>Reconciliation</CardTitle>
            <Pill tone={rec.data.allMatch ? 'success' : 'danger'}>
              {rec.data.matched} of {rec.data.loans} match
            </Pill>
          </div>
          <p className="m-0 text-sm text-ink-muted">
            File total <Money amount={rec.data.sheetTotal} /> · ledger opening balances{' '}
            <Money amount={rec.data.ledgerTotal} />
          </p>
          <Table minWidth={760}>
            <thead>
              <tr>
                <Th>Line</Th>
                <Th>Loan</Th>
                <Th numeric>In the file</Th>
                <Th numeric>Opening balance</Th>
                <Th numeric>Outstanding now</Th>
                <Th>Check</Th>
              </tr>
            </thead>
            <tbody>
              {rec.data.items.map((i) => (
                <tr key={i.loanRef}>
                  <Td className="tabular-nums">{i.line}</Td>
                  <Td>
                    <div className="flex flex-col">
                      {i.loanCode ? (
                        <Link href={`/loans/${i.loanCode}`} className="font-semibold">
                          {i.loanCode}
                        </Link>
                      ) : (
                        '—'
                      )}
                      <span className="text-xs text-ink-muted">
                        {i.loanRef} · {i.borrowerName}
                      </span>
                    </div>
                  </Td>
                  <Td numeric className="font-normal">
                    <Money amount={i.sheetOutstanding} bare />
                  </Td>
                  <Td numeric className="font-normal">
                    <Money amount={i.openingPrincipal} bare />
                  </Td>
                  <Td numeric>
                    <Money amount={i.currentPrincipal} bare />
                  </Td>
                  <Td>
                    <Pill tone={i.matches ? 'success' : 'danger'}>
                      {i.matches ? 'Matches' : 'Differs'}
                    </Pill>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : b.rows.length ? (
        <Card className="gap-3">
          <CardTitle>Clean rows</CardTitle>
          <Table minWidth={760}>
            <thead>
              <tr>
                <Th>Line</Th>
                <Th>Loan</Th>
                <Th>Product</Th>
                <Th numeric>Outstanding</Th>
                <Th numeric>In arrears</Th>
                <Th>Next due</Th>
                <Th numeric>Left</Th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => (
                <tr key={r.line}>
                  <Td className="tabular-nums">{r.line}</Td>
                  <Td>
                    <div className="flex flex-col">
                      <span className="font-semibold">{r.loanRef}</span>
                      <span className="text-xs text-ink-muted">{r.borrowerName}</span>
                    </div>
                  </Td>
                  <Td className="text-ink-soft">{r.productCode}</Td>
                  <Td numeric>
                    <Money amount={r.outstandingPrincipal} bare />
                  </Td>
                  <Td numeric className="font-normal">
                    <Money amount={r.arrearsPrincipal} bare />
                  </Td>
                  <Td className="text-ink-soft">
                    {r.nextDueDate ? formatDate(r.nextDueDate) : '—'}
                  </Td>
                  <Td numeric className="font-normal">
                    {r.remainingInstalments}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}
