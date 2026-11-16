import { formatDate } from '@kora/core';
import { buttonClasses, Card, EmptyState, Money, Table, Td, Th, WarningIcon } from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumb } from '@/components/list-tools';
import { PageHeader } from '@/components/page-header';
import { serverApi } from '@/lib/server-api';
import type { AccountType } from '@/lib/types';

export const metadata: Metadata = { title: 'Account ledger' };

interface AccountLedger {
  code: string;
  name: string;
  type: AccountType;
  from: string;
  to: string;
  openingBalance: string;
  closingBalance: string;
  entries: Array<{
    id: string;
    effectiveOn: string;
    type: string;
    memo: string | null;
    loanCode: string | null;
    debit: string;
    credit: string;
    balance: string;
  }>;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const isDate = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Every posting on one account, with its running balance. */
export default async function AccountLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (isDate(one(sp.from))) qs.set('from', one(sp.from)!);
  if (isDate(one(sp.to))) qs.set('to', one(sp.to)!);
  const res = await serverApi<AccountLedger>(
    `/accounting/accounts/${encodeURIComponent(code)}/ledger?${qs.toString()}`,
  );
  if (!res.ok) {
    return (
      <>
        <PageHeader title={`Account ${code}`} />
        <EmptyState icon={<WarningIcon />} title="Couldn’t load this account">
          <Link href="/accounting?tab=accounts" className={buttonClasses({ variant: 'secondary' })}>
            Back to the chart of accounts
          </Link>
        </EmptyState>
      </>
    );
  }
  const a = res.data;
  return (
    <>
      <Breadcrumb parent="Accounting" parentHref="/accounting?tab=accounts" current={a.code} />
      <PageHeader
        eyebrow={`${formatDate(a.from)} to ${formatDate(a.to)}`}
        title={`${a.code} · ${a.name}`}
      />
      <form className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          From
          <input
            type="date"
            name="from"
            defaultValue={a.from}
            className="h-11 rounded-control border border-line bg-surface px-3 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-medium">
          To
          <input
            type="date"
            name="to"
            defaultValue={a.to}
            className="h-11 rounded-control border border-line bg-surface px-3 text-sm"
          />
        </label>
        <button type="submit" className={buttonClasses({ variant: 'secondary' })}>
          Update
        </button>
      </form>
      <Card className="gap-3">
        <Table minWidth={760}>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Entry</Th>
              <Th numeric>Debit</Th>
              <Th numeric>Credit</Th>
              <Th numeric>Balance</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td className="text-ink-soft">{formatDate(a.from)}</Td>
              <Td className="font-semibold">Opening balance</Td>
              <Td />
              <Td />
              <Td numeric>
                <Money amount={a.openingBalance} bare />
              </Td>
            </tr>
            {a.entries.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-ink-soft">{formatDate(e.effectiveOn)}</Td>
                <Td>
                  <div className="flex flex-col">
                    <span>{e.memo ?? e.type.toLowerCase().replace(/_/g, ' ')}</span>
                    {e.loanCode ? (
                      <Link href={`/loans/${e.loanCode}`} className="text-xs">
                        {e.loanCode}
                      </Link>
                    ) : null}
                  </div>
                </Td>
                <Td numeric className="font-normal">
                  {e.debit !== '0' ? <Money amount={e.debit} bare /> : ''}
                </Td>
                <Td numeric className="font-normal">
                  {e.credit !== '0' ? <Money amount={e.credit} bare /> : ''}
                </Td>
                <Td numeric>
                  <Money amount={e.balance} bare />
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="m-0 text-xs text-ink-muted">
          Balances in the account’s normal direction, RWF. Closing balance:{' '}
          <Money amount={a.closingBalance} />.
        </p>
      </Card>
    </>
  );
}
