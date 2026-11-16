import { BUREAU_COLUMNS, FINANCE_ROLES, OVERSIGHT_ROLES } from '@kora/core';
import { Card, CardTitle, EmptyState, Money, Pill, ShieldIcon, Table, Td, Th } from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { dateTime } from '@/lib/format';
import { serverApi } from '@/lib/server-api';
import type { Me } from '@/lib/types';
import { GenerateForm } from './bureau-actions';
import { type BureauSubmissionRow, monthLabel, STATUS } from './types';

export const metadata: Metadata = { title: 'Credit bureau' };

/** PRD §15.6 and Appendix A.11: every loan, every month, to the credit bureau. */
export default async function BureauPage() {
  const me = await serverApi<Me>('/auth/me');
  if (!me.ok) redirect('/login');
  if (!(OVERSIGHT_ROLES as readonly string[]).includes(me.data.role)) notFound();
  const res = await serverApi<{
    submissions: BureauSubmissionRow[];
    lastLenderCode: string | null;
  }>('/bureau/submissions');
  const canBuild = (FINANCE_ROLES as readonly string[]).includes(me.data.role);
  const rows = res.ok ? res.data.submissions : [];

  return (
    <>
      <PageHeader
        eyebrow="Monthly loan data for the credit reference bureau"
        title="Credit bureau"
      />
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="gap-3">
          <CardTitle>How it works</CardTitle>
          <ol className="m-0 flex flex-col gap-2 pl-5 text-sm">
            <li>
              After each month ends, build its file. It holds every loan open during the month, with
              balances, arrears and BNR class as they stood on the last day.
            </li>
            <li>
              Loans the bureau could not match (no national ID or RDB code, or a bad phone number)
              are left out and listed, so they can be fixed and the file rebuilt.
            </li>
            <li>Download the file, upload it to the bureau, and record their reference.</li>
            <li>
              Record the bureau’s answer. A rejected file is never changed: build a correction file
              for the same month.
            </li>
          </ol>
          <p className="m-0 text-xs text-ink-muted">
            Before the first live upload, your compliance officer should check the columns against
            the bureau’s current data specification and its test upload.
          </p>
          {canBuild ? (
            <GenerateForm lastLenderCode={res.ok ? res.data.lastLenderCode : null} />
          ) : null}
        </Card>
        <Card className="gap-3">
          <CardTitle>Columns</CardTitle>
          <div className="max-h-[420px] overflow-y-auto">
            <Table minWidth={320}>
              <tbody>
                {BUREAU_COLUMNS.map((c) => (
                  <tr key={c.name}>
                    <Td className="font-mono text-xs">{c.name}</Td>
                    <Td className="text-xs text-ink-soft">{c.help}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>
      </div>

      <h2 className="m-0 font-display text-lg font-semibold">Files</h2>
      {rows.length === 0 ? (
        <EmptyState icon={<ShieldIcon />} title="No files yet">
          Monthly files and what the bureau said about them appear here.
        </EmptyState>
      ) : (
        <Card>
          <Table minWidth={760}>
            <thead>
              <tr>
                <Th>Month</Th>
                <Th numeric>Loans</Th>
                <Th numeric>Left out</Th>
                <Th numeric>Balance</Th>
                <Th>Status</Th>
                <Th>Reference</Th>
                <Th>Built</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <Link href={`/bureau/${r.id}`} className="font-semibold">
                      {monthLabel(r.month)}
                      {r.sequence > 1 ? ` · correction ${r.sequence - 1}` : ''}
                    </Link>
                  </Td>
                  <Td numeric className="font-normal">
                    {r.recordCount}
                  </Td>
                  <Td numeric className={r.excludedCount ? 'text-rust' : 'font-normal'}>
                    {r.excludedCount}
                  </Td>
                  <Td numeric>
                    <Money amount={r.totalBalance} bare />
                  </Td>
                  <Td>
                    <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
                  </Td>
                  <Td className="text-ink-soft">{r.bureauReference ?? '—'}</Td>
                  <Td className="text-ink-soft">{dateTime(r.generatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
