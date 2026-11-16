import { formatDate, MIGRATION_COLUMNS } from '@kora/core';
import { Card, CardTitle, EmptyState, Money, Pill, ShieldIcon, Table, Td, Th } from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { dateTime } from '@/lib/format';
import { serverApi } from '@/lib/server-api';
import type { Me } from '@/lib/types';
import { UploadForm } from './import-actions';
import { STATUS } from './status';

export const metadata: Metadata = { title: 'Import loan book' };

interface BatchRow {
  id: string;
  fileName: string;
  asOf: string;
  status: 'INVALID' | 'VALIDATED' | 'IMPORTED' | 'SIGNED_OFF';
  rowCount: number;
  totalOutstanding: string;
  createdAt: string;
}

/** PRD §6.14: bring the existing loan book in from spreadsheets. */
export default async function ImportPage() {
  const me = await serverApi<Me>('/auth/me');
  if (!me.ok) redirect('/login');
  const allowed = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'AUDITOR'];
  if (!allowed.includes(me.data.role)) notFound();
  const batches = await serverApi<BatchRow[]>('/migration/batches');
  const canUpload = me.data.role === 'ADMIN' || me.data.role === 'MANAGER';

  return (
    <>
      <PageHeader eyebrow="Move active loans from your spreadsheets" title="Import loan book" />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="gap-3">
          <CardTitle>How it works</CardTitle>
          <ol className="m-0 flex flex-col gap-2 pl-5 text-sm">
            <li>
              Download the <a href="/api/migration/template.csv">template</a> and fill in one row
              per active loan, with balances as of your cut-over date. Excel (.xlsx) or CSV.
            </li>
            <li>Upload it. Every problem is listed by line; fix them and upload again.</li>
            <li>
              Import a clean file: borrowers, loans, remaining schedules and opening ledger balances
              are created together, or not at all.
            </li>
            <li>
              Check the reconciliation, loan by loan. A second person (the Finance Manager) signs it
              off.
            </li>
          </ol>
          <p className="m-0 text-xs text-ink-muted">
            Remaining instalments are rebuilt monthly on the reducing balance at each loan’s rate,
            from the next due date. Arrears become one overdue instalment dated at the oldest
            arrears date. Opening balances post to account 3900 for your accountant to reclassify.
          </p>
          {canUpload ? <UploadForm /> : null}
        </Card>
        <Card className="gap-3">
          <CardTitle>Columns</CardTitle>
          <Table minWidth={360}>
            <tbody>
              {MIGRATION_COLUMNS.map((c) => (
                <tr key={c.header}>
                  <Td className="font-mono text-xs">
                    {c.header}
                    {c.required ? <span className="text-rust"> *</span> : null}
                  </Td>
                  <Td className="text-xs text-ink-soft">{c.help}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <h2 className="m-0 font-display text-lg font-semibold">Uploads</h2>
      {!batches.ok || batches.data.length === 0 ? (
        <EmptyState icon={<ShieldIcon />} title="Nothing uploaded yet">
          Uploads and their status appear here.
        </EmptyState>
      ) : (
        <Card>
          <Table minWidth={720}>
            <thead>
              <tr>
                <Th>File</Th>
                <Th>Cut-over</Th>
                <Th numeric>Loans</Th>
                <Th numeric>Outstanding</Th>
                <Th>Status</Th>
                <Th>Uploaded</Th>
              </tr>
            </thead>
            <tbody>
              {batches.data.map((b) => (
                <tr key={b.id}>
                  <Td>
                    <Link href={`/import/${b.id}`} className="font-semibold">
                      {b.fileName}
                    </Link>
                  </Td>
                  <Td className="text-ink-soft">{formatDate(b.asOf)}</Td>
                  <Td numeric className="font-normal">
                    {b.rowCount}
                  </Td>
                  <Td numeric>
                    <Money amount={b.totalOutstanding} bare />
                  </Td>
                  <Td>
                    <Pill tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Pill>
                  </Td>
                  <Td className="text-ink-soft">{dateTime(b.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
