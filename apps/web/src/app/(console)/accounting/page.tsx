import { formatDate, formatMonthYear, FINANCE_ROLES, OVERSIGHT_ROLES } from '@kora/core';
import {
  buttonClasses,
  Card,
  CardTitle,
  chipClasses,
  EmptyState,
  Money,
  Pill,
  ShieldIcon,
  Table,
  Td,
  Th,
  WarningIcon,
} from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { dateTime } from '@/lib/format';
import { serverApi } from '@/lib/server-api';
import type {
  BalanceSheetReport,
  IncomeStatementReport,
  JournalRow,
  LedgerAccountRow,
  Me,
  PeriodRow,
  StatementLineRow,
  TrialBalanceReport,
  WriteOffRequest,
} from '@/lib/types';
import {
  AddAccountButton,
  DecideJournal,
  NewEntryButtons,
  PeriodActions,
  WriteOffDecision,
} from './accounting-actions';

export const metadata: Metadata = { title: 'Accounting' };

const TABS = [
  ['statements', 'Statements'],
  ['trial-balance', 'Trial balance'],
  ['journals', 'Journals'],
  ['write-offs', 'Write-offs'],
  ['periods', 'Periods'],
  ['accounts', 'Chart of accounts'],
] as const;
type Tab = (typeof TABS)[number][0];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const me = await serverApi<Me>('/auth/me');
  if (!me.ok) redirect('/login');
  if (!(OVERSIGHT_ROLES as readonly string[]).includes(me.data.role)) notFound();
  const canPost = (FINANCE_ROLES as readonly string[]).includes(me.data.role);
  const tab: Tab = TABS.find(([t]) => t === one(sp.tab))?.[0] ?? 'statements';
  const today = new Date(Date.now() + 2 * 3600_000).toISOString().slice(0, 10);
  const to = isDate(one(sp.to)) ? one(sp.to)! : today;
  const from = isDate(one(sp.from)) ? one(sp.from)! : `${to.slice(0, 4)}-01-01`;

  const accounts = await serverApi<LedgerAccountRow[]>('/accounting/accounts');
  const accountOptions = accounts.ok
    ? accounts.data
        .filter((a) => a.isActive && !a.control)
        .map((a) => ({ code: a.code, name: a.name, type: a.type }))
    : [];

  return (
    <>
      <PageHeader eyebrow="Double-entry books, from the ledger" title="Accounting">
        {canPost ? <NewEntryButtons accounts={accountOptions} today={today} /> : null}
      </PageHeader>
      <nav className="flex flex-wrap gap-2" aria-label="Accounting sections">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={key === 'statements' ? '/accounting' : `/accounting?tab=${key}`}
            className={chipClasses(tab === key)}
            aria-current={tab === key ? 'page' : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === 'statements' ? <Statements from={from} to={to} /> : null}
      {tab === 'trial-balance' ? <TrialBalance asOf={to} /> : null}
      {tab === 'journals' ? <Journals me={me.data} canPost={canPost} /> : null}
      {tab === 'write-offs' ? <WriteOffs me={me.data} /> : null}
      {tab === 'periods' ? <Periods me={me.data} /> : null}
      {tab === 'accounts' && accounts.ok ? (
        <Accounts
          rows={accounts.data}
          canAdd={me.data.role === 'ADMIN' || me.data.role === 'ACCOUNTANT'}
        />
      ) : null}
    </>
  );
}

function Failed({ what }: { what: string }) {
  return (
    <EmptyState icon={<WarningIcon />} title={`Couldn’t load ${what}`}>
      The server didn’t answer. Reload the page to try again.
    </EmptyState>
  );
}

function DateForm({
  tab,
  from,
  to,
  single,
}: {
  tab: string;
  from?: string;
  to: string;
  single?: boolean;
}) {
  return (
    <form action="/accounting" className="flex flex-wrap items-end gap-3">
      {tab !== 'statements' ? <input type="hidden" name="tab" value={tab} /> : null}
      {single ? null : (
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          From
          <input
            type="date"
            name="from"
            defaultValue={from}
            className="h-11 rounded-control border border-line bg-surface px-3 text-sm"
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-[13px] font-medium">
        {single ? 'As of' : 'To'}
        <input
          type="date"
          name="to"
          defaultValue={to}
          className="h-11 rounded-control border border-line bg-surface px-3 text-sm"
        />
      </label>
      <button type="submit" className={buttonClasses({ variant: 'secondary' })}>
        Update
      </button>
    </form>
  );
}

function Lines({ rows }: { rows: StatementLineRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <tr key={r.code}>
          <Td className="w-16 text-ink-muted tabular-nums">{r.code}</Td>
          <Td>
            <Link href={`/accounting/accounts/${r.code}`}>{r.name}</Link>
          </Td>
          <Td numeric className="font-normal">
            <Money amount={r.amount} bare />
          </Td>
        </tr>
      ))}
    </>
  );
}

function TotalRow({ label, amount, strong }: { label: string; amount: string; strong?: boolean }) {
  return (
    <tr>
      <Td />
      <Td className={strong ? 'font-semibold' : 'text-ink-soft'}>{label}</Td>
      <Td numeric>
        <Money amount={amount} bare />
      </Td>
    </tr>
  );
}

function CsvLink({ statement, from, to }: { statement: string; from?: string; to: string }) {
  const qs = new URLSearchParams({ statement, to, ...(from ? { from } : {}) });
  return (
    <a
      href={`/api/accounting/export.csv?${qs.toString()}`}
      className={buttonClasses({ variant: 'secondary' })}
    >
      Download CSV
    </a>
  );
}

async function Statements({ from, to }: { from: string; to: string }) {
  const [is, bs] = await Promise.all([
    serverApi<IncomeStatementReport>(`/accounting/income-statement?from=${from}&to=${to}`),
    serverApi<BalanceSheetReport>(`/accounting/balance-sheet?asOf=${to}`),
  ]);
  return (
    <>
      <DateForm tab="statements" from={from} to={to} />
      <div className="grid gap-4 lg:grid-cols-2">
        {is.ok ? (
          <Card className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Income statement</CardTitle>
              <CsvLink statement="income-statement" from={from} to={to} />
            </div>
            <p className="m-0 text-sm text-ink-muted">
              {formatDate(is.data.from)} to {formatDate(is.data.to)}
            </p>
            <Table minWidth={420}>
              <tbody>
                <tr>
                  <Th colSpan={3}>Income</Th>
                </tr>
                <Lines rows={is.data.income} />
                <TotalRow label="Total income" amount={is.data.totalIncome} />
                <tr>
                  <Th colSpan={3}>Expenses</Th>
                </tr>
                <Lines rows={is.data.expenses} />
                <TotalRow label="Total expenses" amount={is.data.totalExpenses} />
                <TotalRow
                  label={BigInt(is.data.netProfit) < 0n ? 'Net loss' : 'Net profit'}
                  amount={is.data.netProfit}
                  strong
                />
              </tbody>
            </Table>
          </Card>
        ) : (
          <Failed what="the income statement" />
        )}
        {bs.ok ? (
          <Card className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Balance sheet</CardTitle>
              <CsvLink statement="balance-sheet" to={to} />
            </div>
            <p className="m-0 flex items-center gap-2 text-sm text-ink-muted">
              As of {formatDate(bs.data.asOf)}
              <Pill tone={bs.data.balanced ? 'success' : 'danger'}>
                {bs.data.balanced ? 'Balances' : 'Does not balance'}
              </Pill>
            </p>
            <Table minWidth={420}>
              <tbody>
                <tr>
                  <Th colSpan={3}>Assets</Th>
                </tr>
                <Lines rows={bs.data.assets} />
                <TotalRow label="Total assets" amount={bs.data.totalAssets} strong />
                <tr>
                  <Th colSpan={3}>Liabilities</Th>
                </tr>
                <Lines rows={bs.data.liabilities} />
                <TotalRow label="Total liabilities" amount={bs.data.totalLiabilities} />
                <tr>
                  <Th colSpan={3}>Equity</Th>
                </tr>
                <Lines rows={bs.data.equity} />
                <TotalRow label="Earnings to date" amount={bs.data.currentEarnings} />
                <TotalRow label="Total equity" amount={bs.data.totalEquity} />
                <TotalRow
                  label="Liabilities and equity"
                  amount={(
                    BigInt(bs.data.totalLiabilities) + BigInt(bs.data.totalEquity)
                  ).toString()}
                  strong
                />
              </tbody>
            </Table>
          </Card>
        ) : (
          <Failed what="the balance sheet" />
        )}
      </div>
      <p className="m-0 text-xs text-ink-muted">
        Amounts in RWF. The loan-loss allowance is shown as a negative asset.
      </p>
    </>
  );
}

async function TrialBalance({ asOf }: { asOf: string }) {
  const tb = await serverApi<TrialBalanceReport>(`/accounting/trial-balance?asOf=${asOf}`);
  if (!tb.ok) return <Failed what="the trial balance" />;
  return (
    <>
      <DateForm tab="trial-balance" to={asOf} single />
      <Card className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 flex items-center gap-2 text-sm text-ink-muted">
            As of {formatDate(tb.data.asOf)}
            <Pill tone={tb.data.balanced ? 'success' : 'danger'}>
              {tb.data.balanced ? 'Debits equal credits' : 'Out of balance'}
            </Pill>
          </p>
          <CsvLink statement="trial-balance" to={asOf} />
        </div>
        <Table minWidth={560}>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Account</Th>
              <Th numeric>Debit</Th>
              <Th numeric>Credit</Th>
            </tr>
          </thead>
          <tbody>
            {tb.data.rows.map((r) => (
              <tr key={r.code}>
                <Td className="text-ink-muted tabular-nums">{r.code}</Td>
                <Td>
                  <Link href={`/accounting/accounts/${r.code}`}>{r.name}</Link>
                </Td>
                <Td numeric className="font-normal">
                  {r.debit !== '0' ? <Money amount={r.debit} bare /> : ''}
                </Td>
                <Td numeric className="font-normal">
                  {r.credit !== '0' ? <Money amount={r.credit} bare /> : ''}
                </Td>
              </tr>
            ))}
            <tr>
              <Td />
              <Td className="font-semibold">Total</Td>
              <Td numeric>
                <Money amount={tb.data.totalDebit} bare />
              </Td>
              <Td numeric>
                <Money amount={tb.data.totalCredit} bare />
              </Td>
            </tr>
          </tbody>
        </Table>
      </Card>
    </>
  );
}

const STATUS_TONE = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'neutral' } as const;
const STATUS_LABEL = { PENDING: 'Waiting', APPROVED: 'Posted', REJECTED: 'Rejected' } as const;

async function Journals({ me, canPost }: { me: Me; canPost: boolean }) {
  const res = await serverApi<JournalRow[]>('/accounting/journals');
  if (!res.ok) return <Failed what="journals" />;
  if (!res.data.length) {
    return (
      <EmptyState icon={<ShieldIcon />} title="No journals yet">
        Expenses and other manual entries appear here. Each one posts after a second person approves
        it.
      </EmptyState>
    );
  }
  return (
    <Card className="gap-3">
      <Table minWidth={900}>
        <thead>
          <tr>
            <Th>Journal</Th>
            <Th>Date</Th>
            <Th>Lines</Th>
            <Th numeric>Amount</Th>
            <Th>Status</Th>
            <Th>People</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {res.data.map((j) => (
            <tr key={j.id}>
              <Td>
                <div className="flex flex-col">
                  <span className="font-semibold">{j.code}</span>
                  <span className="text-xs text-ink-muted">{j.memo}</span>
                </div>
              </Td>
              <Td className="whitespace-nowrap text-ink-soft">{formatDate(j.effectiveOn)}</Td>
              <Td className="text-xs">
                {j.lines.map((l, i) => (
                  <div key={i} className="tabular-nums">
                    {l.direction === 'DEBIT' ? 'Dr' : 'Cr'} {l.accountCode} ·{' '}
                    <Money amount={l.amount} bare />
                  </div>
                ))}
              </Td>
              <Td numeric>
                <Money amount={j.total} bare />
              </Td>
              <Td>
                <Pill tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Pill>
                {j.rejectReason ? (
                  <span className="mt-1 block text-xs text-ink-muted">{j.rejectReason}</span>
                ) : null}
              </Td>
              <Td className="text-xs text-ink-soft">
                Drafted by {j.requestedBy ?? '—'}
                {j.decidedBy ? (
                  <>
                    <br />
                    {j.status === 'APPROVED' ? 'Approved' : 'Rejected'} by {j.decidedBy}
                    {j.decidedAt ? `, ${dateTime(j.decidedAt)}` : ''}
                  </>
                ) : null}
              </Td>
              <Td>
                {j.status === 'PENDING' && canPost && j.requestedById !== me.id ? (
                  <DecideJournal code={j.code} />
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

async function WriteOffs({ me }: { me: Me }) {
  const res = await serverApi<WriteOffRequest[]>('/write-offs');
  if (!res.ok) return <Failed what="write-offs" />;
  if (!res.data.length) {
    return (
      <EmptyState icon={<ShieldIcon />} title="No write-offs">
        Write-offs are requested from a non-performing loan’s page and approved by a second manager.
      </EmptyState>
    );
  }
  const canDecide = me.role === 'MANAGER' || me.role === 'ADMIN';
  return (
    <Card className="gap-3">
      <Table minWidth={860}>
        <thead>
          <tr>
            <Th>Loan</Th>
            <Th>Reason</Th>
            <Th numeric>Principal</Th>
            <Th numeric>Interest</Th>
            <Th numeric>From allowance</Th>
            <Th>Status</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {res.data.map((w) => (
            <tr key={w.id}>
              <Td>
                <div className="flex flex-col">
                  <Link href={`/loans/${w.loanCode}`} className="font-semibold">
                    {w.loanCode}
                  </Link>
                  <span className="text-xs text-ink-muted">{w.borrowerName}</span>
                </div>
              </Td>
              <Td className="max-w-[260px] text-xs text-ink-soft">{w.reason}</Td>
              <Td numeric>
                <Money amount={w.principal} bare />
              </Td>
              <Td numeric className="font-normal">
                <Money amount={w.interest} bare />
              </Td>
              <Td numeric className="font-normal">
                <Money amount={w.allowanceUsed} bare />
              </Td>
              <Td>
                <Pill tone={STATUS_TONE[w.status]}>
                  {w.status === 'APPROVED' ? 'Written off' : STATUS_LABEL[w.status]}
                </Pill>
              </Td>
              <Td>
                {w.status === 'PENDING' && canDecide && w.requestedById !== me.id ? (
                  <WriteOffDecision id={w.id} />
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

async function Periods({ me }: { me: Me }) {
  const res = await serverApi<PeriodRow[]>('/accounting/periods');
  if (!res.ok) return <Failed what="accounting periods" />;
  const canClose = me.role === 'ADMIN' || me.role === 'ACCOUNTANT' || me.role === 'MANAGER';
  return (
    <Card className="gap-3">
      <p className="m-0 text-sm text-ink-muted">
        Close a month once its books are final. Nothing can then be posted with a date in it, until
        an administrator reopens it with a reason.
      </p>
      <Table minWidth={720}>
        <thead>
          <tr>
            <Th>Month</Th>
            <Th>Status</Th>
            <Th>Details</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {res.data.map((p) => (
            <tr key={p.month}>
              <Td className="font-semibold">{formatMonthYear(p.month)}</Td>
              <Td>
                <Pill tone={p.closed ? 'neutral' : 'success'}>{p.closed ? 'Closed' : 'Open'}</Pill>
              </Td>
              <Td className="text-xs text-ink-soft">
                {p.closed && p.closedAt
                  ? `Closed by ${p.closedBy ?? '—'}, ${dateTime(p.closedAt)}`
                  : null}
                {!p.closed && p.reopenedAt
                  ? `Reopened by ${p.reopenedBy ?? '—'}: ${p.reopenReason ?? ''}`
                  : null}
                {p.pendingJournals ? ` ${p.pendingJournals} journal(s) waiting` : null}
              </Td>
              <Td>
                <PeriodActions
                  month={p.month}
                  closed={p.closed}
                  canClose={canClose && p.canClose}
                  canReopen={me.role === 'ADMIN' && p.closed}
                />
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

const TYPE_LABEL = {
  ASSET: 'Asset',
  LIABILITY: 'Liability',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expense',
} as const;

function Accounts({ rows, canAdd }: { rows: LedgerAccountRow[]; canAdd: boolean }) {
  return (
    <Card className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm text-ink-muted">
          Loan control accounts move only through loan events. Add your own accounts for expenses
          and other income.
        </p>
        {canAdd ? <AddAccountButton /> : null}
      </div>
      <Table minWidth={720}>
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Account</Th>
            <Th>Type</Th>
            <Th numeric>Debits</Th>
            <Th numeric>Credits</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.code} className={a.isActive ? undefined : 'opacity-60'}>
              <Td className="text-ink-muted tabular-nums">{a.code}</Td>
              <Td>
                <Link href={`/accounting/accounts/${a.code}`}>{a.name}</Link>
              </Td>
              <Td className="text-ink-soft">{TYPE_LABEL[a.type]}</Td>
              <Td numeric className="font-normal">
                <Money amount={a.debits} bare />
              </Td>
              <Td numeric className="font-normal">
                <Money amount={a.credits} bare />
              </Td>
              <Td className="text-xs text-ink-muted">
                {a.control ? 'Loan control' : a.system ? 'Built-in' : 'Added'}
                {a.isActive ? '' : ' · off'}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
