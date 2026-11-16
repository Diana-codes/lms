import { STAFF_ROLE_LABELS, type StaffRole } from '@kora/core';
import { buttonClasses, Card, EmptyState, ShieldIcon, Table, Td, Th, WarningIcon } from '@kora/ui';
import type { Metadata } from 'next';
import { listHref, Pagination } from '@/components/list-tools';
import { PageHeader } from '@/components/page-header';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Audit log' };

interface AuditItem {
  id: string;
  at: string;
  action: string;
  actorType: string;
  actor: string | null;
  actorRole: StaffRole | null;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ip: string | null;
}
interface AuditPage {
  total: number;
  page: number;
  pageSize: number;
  items: AuditItem[];
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const when = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Kigali',
});

/** PRD §14.5 / US-13: every recorded action, newest first, read-only. */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const filters = {
    action: one(sp.action)?.trim() || undefined,
    entityId: one(sp.entityId)?.trim() || undefined,
    from: one(sp.from) || undefined,
    to: one(sp.to) || undefined,
  };
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const res = await serverApi<AuditPage>(listHref('/audit-logs', { ...filters, page }));

  return (
    <>
      <PageHeader eyebrow="Who did what, and when" title="Audit log" />
      <form action="/audit-log" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          Action starts with
          <input
            name="action"
            defaultValue={filters.action}
            placeholder="loan.writeoff"
            className="h-11 rounded-control border border-line bg-surface px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          Record
          <input
            name="entityId"
            defaultValue={filters.entityId}
            placeholder="LN-0418-2026"
            className="h-11 rounded-control border border-line bg-surface px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          From
          <input
            type="date"
            name="from"
            defaultValue={filters.from}
            className="h-11 rounded-control border border-line bg-surface px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          To
          <input
            type="date"
            name="to"
            defaultValue={filters.to}
            className="h-11 rounded-control border border-line bg-surface px-3 text-sm"
          />
        </label>
        <button type="submit" className={buttonClasses({ variant: 'secondary' })}>
          Filter
        </button>
      </form>

      {!res.ok ? (
        res.status === 403 ? (
          <EmptyState icon={<ShieldIcon />} title="The audit log is for managers and auditors">
            Ask an administrator if you need access.
          </EmptyState>
        ) : (
          <EmptyState icon={<WarningIcon />} title="Couldn’t load the audit log">
            The server didn’t answer. Reload the page to try again.
          </EmptyState>
        )
      ) : res.data.items.length === 0 ? (
        <EmptyState icon={<ShieldIcon />} title="Nothing recorded for these filters">
          Try a wider date range or clear the filters.
        </EmptyState>
      ) : (
        <Card className="gap-3">
          <Table minWidth={860}>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Record</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {res.data.items.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-ink-soft">{when.format(new Date(r.at))}</Td>
                  <Td>
                    <div className="flex flex-col">
                      <span className="font-semibold">{r.actor ?? '—'}</span>
                      <span className="text-xs text-ink-muted">
                        {r.actorRole ? STAFF_ROLE_LABELS[r.actorRole] : r.actorType.toLowerCase()}
                      </span>
                    </div>
                  </Td>
                  <Td className="font-mono text-xs">{r.action}</Td>
                  <Td className="text-ink-soft">
                    {r.entityType ? `${r.entityType} ${r.entityId ?? ''}` : '—'}
                  </Td>
                  <Td className="max-w-[320px] truncate font-mono text-xs text-ink-muted">
                    {r.metadata ? JSON.stringify(r.metadata) : ''}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={res.data.page}
            pages={Math.max(1, Math.ceil(res.data.total / res.data.pageSize))}
            total={res.data.total}
            noun="record"
            href={(p) => listHref('/audit-log', { ...filters, page: p })}
          />
        </Card>
      )}
    </>
  );
}
