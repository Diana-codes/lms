'use client';

import { formatRwf } from '@kora/core';
import {
  Button,
  FormError,
  Modal,
  SelectField,
  TextAreaField,
  TextField,
  useToast,
} from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { groupDigits } from '@/lib/format';
import type { AccountType } from '@/lib/types';

type AccountOption = { code: string; name: string; type: AccountType };

const message = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
const digits = (v: string) => (v ? BigInt(v.replace(/,/g, '') || '0') : 0n);

const PAID_FROM = [
  ['BANK', 'Bank account'],
  ['MOMO_FLOAT', 'MTN MoMo float'],
  ['AIRTEL_FLOAT', 'Airtel Money float'],
  ['BRANCH_CASH', 'Cash at branch'],
  ['ACCRUED_EXPENSES', 'Not paid yet (payable)'],
] as const;

export function NewEntryButtons({ accounts, today }: { accounts: AccountOption[]; today: string }) {
  const [open, setOpen] = useState<'expense' | 'journal' | null>(null);
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => setOpen('journal')}>
        New journal
      </Button>
      <Button onClick={() => setOpen('expense')}>Record expense</Button>
      {open === 'expense' ? (
        <ExpenseModal accounts={accounts} today={today} onClose={() => setOpen(null)} />
      ) : null}
      {open === 'journal' ? (
        <JournalModal accounts={accounts} today={today} onClose={() => setOpen(null)} />
      ) : null}
    </div>
  );
}

function ExpenseModal({
  accounts,
  today,
  onClose,
}: {
  accounts: AccountOption[];
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const expenses = accounts.filter((a) => a.type === 'EXPENSE');
  const [account, setAccount] = useState(expenses[0]?.code ?? '');
  const [paidFrom, setPaidFrom] = useState<string>('BANK');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ code: string }>('/accounting/expenses', {
        method: 'POST',
        body: {
          expenseAccount: account,
          paidFrom,
          amount: digits(amount).toString(),
          effectiveOn: date,
          memo,
        },
      });
      toast(`${res.code} drafted. A second person must approve it before it posts.`);
      onClose();
      router.refresh();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Record expense" subtitle="Posts after a second approval">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <SelectField label="Expense" value={account} onChange={(e) => setAccount(e.target.value)}>
          {expenses.map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} · {a.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Paid from"
          value={paidFrom}
          onChange={(e) => setPaidFrom(e.target.value)}
        >
          {PAID_FROM.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </SelectField>
        <div className="grid grid-cols-2 gap-2.5">
          <TextField
            label="Amount (RWF)"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(groupDigits(e.target.value))}
            data-autofocus
          />
          <TextField
            label="Date"
            type="date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <TextField
          label="Description"
          placeholder="e.g. Office rent, November"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={!account || digits(amount) === 0n || memo.trim().length < 3}
          >
            Send for approval
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type Line = { accountCode: string; side: 'DEBIT' | 'CREDIT'; amount: string };

function JournalModal({
  accounts,
  today,
  onClose,
}: {
  accounts: AccountOption[];
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [lines, setLines] = useState<Line[]>([
    { accountCode: accounts[0]?.code ?? '', side: 'DEBIT', amount: '' },
    { accountCode: accounts[1]?.code ?? '', side: 'CREDIT', amount: '' },
  ]);
  const [date, setDate] = useState(today);
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debits = lines.filter((l) => l.side === 'DEBIT').reduce((s, l) => s + digits(l.amount), 0n);
  const credits = lines
    .filter((l) => l.side === 'CREDIT')
    .reduce((s, l) => s + digits(l.amount), 0n);
  const balanced = debits > 0n && debits === credits;
  const set = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ code: string }>('/accounting/journals', {
        method: 'POST',
        body: {
          effectiveOn: date,
          memo,
          lines: lines.map((l) => ({
            accountCode: l.accountCode,
            direction: l.side,
            amount: digits(l.amount).toString(),
          })),
        },
      });
      toast(`${res.code} drafted. A second person must approve it before it posts.`);
      onClose();
      router.refresh();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="New journal"
      subtitle="Posts after a second approval"
      size="lg"
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-[1fr_auto] gap-2.5">
          <TextField
            label="Description"
            placeholder="e.g. Loan from BRD received"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            data-autofocus
          />
          <TextField
            label="Date"
            type="date"
            max={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-[13px] font-medium text-ink-soft">Lines</legend>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_110px_150px_auto] items-end gap-2">
              <SelectField
                label={`Account, line ${i + 1}`}
                hideLabel
                value={l.accountCode}
                onChange={(e) => set(i, { accountCode: e.target.value })}
              >
                {accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label={`Debit or credit, line ${i + 1}`}
                hideLabel
                value={l.side}
                onChange={(e) => set(i, { side: e.target.value as Line['side'] })}
              >
                <option value="DEBIT">Debit</option>
                <option value="CREDIT">Credit</option>
              </SelectField>
              <TextField
                label={`Amount, line ${i + 1}`}
                hideLabel
                inputMode="numeric"
                placeholder="RWF"
                value={l.amount}
                onChange={(e) => set(i, { amount: groupDigits(e.target.value) })}
              />
              <Button
                variant="secondary"
                disabled={lines.length <= 2}
                onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                aria-label={`Remove line ${i + 1}`}
              >
                ×
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            className="self-start"
            onClick={() =>
              setLines((ls) => [
                ...ls,
                { accountCode: accounts[0]?.code ?? '', side: 'DEBIT', amount: '' },
              ])
            }
          >
            Add line
          </Button>
        </fieldset>
        <p
          className={`m-0 text-sm ${balanced ? 'text-success-fg' : 'text-ink-muted'}`}
          role="status"
        >
          Debits {formatRwf(debits)} · Credits {formatRwf(credits)}
          {balanced ? ' · balanced' : debits || credits ? ' · must be equal' : ''}
        </p>
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!balanced || memo.trim().length < 3}>
            Send for approval
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function DecideJournal({ code }: { code: string }) {
  const router = useRouter();
  const toast = useToast();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/accounting/journals/${code}/decide`, {
        method: 'POST',
        body: approve ? { approve } : { approve, reason },
      });
      toast(approve ? `${code} posted.` : `${code} rejected.`);
      setRejecting(false);
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <Button loading={busy && !rejecting} onClick={() => decide(true)}>
          Approve
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>
          Reject
        </Button>
      </div>
      {rejecting ? (
        <Modal open onClose={() => setRejecting(false)} title={`Reject ${code}`}>
          <div className="flex flex-col gap-4">
            <TextAreaField
              label="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-autofocus
            />
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2.5">
              <Button variant="secondary" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
              <Button loading={busy} disabled={!reason.trim()} onClick={() => decide(false)}>
                Reject journal
              </Button>
            </div>
          </div>
        </Modal>
      ) : (
        <FormError>{error}</FormError>
      )}
    </div>
  );
}

export function WriteOffDecision({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/write-offs/${id}/decide`, { method: 'POST', body: { approve } });
      toast(approve ? 'Loan written off.' : 'Request rejected.');
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <Button loading={busy} onClick={() => decide(true)}>
          Approve
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => decide(false)}>
          Reject
        </Button>
      </div>
      <FormError>{error}</FormError>
    </div>
  );
}

export function PeriodActions({
  month,
  closed,
  canClose,
  canReopen,
}: {
  month: string;
  closed: boolean;
  canClose: boolean;
  canReopen: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(path: string, body: object, done: string) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: 'POST', body });
      toast(done);
      setReopening(false);
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      {!closed && canClose ? (
        <Button
          variant="secondary"
          loading={busy}
          onClick={() => run('/accounting/periods/close', { month }, 'Month closed.')}
        >
          Close month
        </Button>
      ) : null}
      {closed && canReopen ? (
        <Button variant="secondary" onClick={() => setReopening(true)}>
          Reopen
        </Button>
      ) : null}
      {reopening ? (
        <Modal open onClose={() => setReopening(false)} title="Reopen month">
          <div className="flex flex-col gap-4">
            <TextAreaField
              label="Why does this month need to change?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-autofocus
            />
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2.5">
              <Button variant="secondary" onClick={() => setReopening(false)}>
                Cancel
              </Button>
              <Button
                loading={busy}
                disabled={reason.trim().length < 5}
                onClick={() =>
                  run('/accounting/periods/reopen', { month, reason }, 'Month reopened.')
                }
              >
                Reopen month
              </Button>
            </div>
          </div>
        </Modal>
      ) : (
        <FormError>{error}</FormError>
      )}
    </div>
  );
}

export function AddAccountButton() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('EXPENSE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/accounting/accounts', { method: 'POST', body: { code, name, type } });
      toast(`Account ${code} added.`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Add account
      </Button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title="Add account">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <SelectField
              label="Type"
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
            >
              <option value="ASSET">Asset (1xxx)</option>
              <option value="LIABILITY">Liability (2xxx)</option>
              <option value="EQUITY">Equity (3xxx)</option>
              <option value="INCOME">Income (4xxx)</option>
              <option value="EXPENSE">Expense (5xxx)</option>
            </SelectField>
            <div className="grid grid-cols-[120px_1fr] gap-2.5">
              <TextField
                label="Code"
                inputMode="numeric"
                maxLength={4}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                data-autofocus
              />
              <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <FormError>{error}</FormError>
            <div className="flex justify-end gap-2.5">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                loading={busy}
                disabled={code.length !== 4 || name.trim().length < 2}
              >
                Add account
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
