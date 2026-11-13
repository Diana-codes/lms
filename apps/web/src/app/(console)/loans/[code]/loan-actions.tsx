'use client';

import {
  formatDate,
  formatRwf,
  monthlyInterest,
  PAYMENT_CHANNEL_LABELS,
  type PaymentChannel,
  quoteExtendTerm,
  quotePaymentHoliday,
} from '@kora/core';
import {
  Button,
  buttonClasses,
  FormError,
  Modal,
  Money,
  OptionButton,
  TextAreaField,
  TextField,
  useToast,
} from '@kora/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { groupDigits, todayIso } from '@/lib/format';
import type { LoanDetail, Me } from '@/lib/types';

const CHANNELS: PaymentChannel[] = ['MTN_MOMO', 'BANK_TRANSFER', 'CASH'];
const message = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Try again.';

export function LoanActions({ loan }: { loan: LoanDetail }) {
  const [modal, setModal] = useState<'pay' | 'restructure' | null>(null);
  const toast = useToast();
  const active = loan.status === 'ACTIVE';

  return (
    <>
      <Button
        variant="secondary"
        disabled={!active || loan.pendingRestructure != null}
        title={
          loan.pendingRestructure ? 'A restructure is already waiting for approval' : undefined
        }
        onClick={() => setModal('restructure')}
      >
        Restructure
      </Button>
      <Link
        href={`/loans/${loan.code}/statement`}
        className={buttonClasses({ variant: 'secondary' })}
      >
        Statement
      </Link>
      <Button onClick={() => (active ? setModal('pay') : toast('This loan is fully repaid.'))}>
        Record payment
      </Button>
      {modal === 'pay' ? <PaymentModal loan={loan} onClose={() => setModal(null)} /> : null}
      {modal === 'restructure' ? (
        <RestructureModal loan={loan} onClose={() => setModal(null)} />
      ) : null}
    </>
  );
}

function PaymentModal({ loan, onClose }: { loan: LoanDetail; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const next = loan.next!;
  const [amount, setAmount] = useState(groupDigits(next.amount));
  const [channel, setChannel] = useState<PaymentChannel>('MTN_MOMO');
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per time the form is opened: pressing Save twice, or a retry
  // after a dropped connection, cannot record the payment twice.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  const value = amount ? BigInt(amount.replace(/,/g, '')) : 0n;
  const owed = BigInt(loan.figures.totalRemaining);
  const due = BigInt(next.amount);
  const amountError =
    value === 0n
      ? 'Enter the amount received'
      : value > owed
        ? `More than the ${formatRwf(owed)} left to pay`
        : null;

  // What this payment will do, worked out the same way the server does it.
  let preview = '';
  if (!amountError) {
    if (value === owed) preview = 'This pays off the loan in full.';
    else if (value === due) preview = `This clears instalment ${next.number} in full.`;
    else if (value < due)
      preview = `This is a part-payment. ${formatRwf(due - value)} of instalment ${next.number} will still be owed. Interest is covered first.`;
    else
      preview = `This clears instalment ${next.number} and puts ${formatRwf(value - due)} towards the next.`;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (amountError) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/loans/${loan.code}/payments`, {
        method: 'POST',
        body: {
          amount: value.toString(),
          channel,
          receivedOn,
          externalRef: reference.trim() || undefined,
          idempotencyKey,
        },
      });
      toast(`Payment of ${formatRwf(value)} recorded.`);
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
      title="Record payment"
      subtitle={`Instalment ${next.number} of ${loan.figures.instalmentCount} · due ${formatDate(next.dueDate, { year: false })}`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField
          label="Amount received (RWF)"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(groupDigits(e.target.value))}
          error={amountError}
          autoComplete="off"
          className="[&_input]:h-[46px] [&_input]:text-xl [&_input]:font-semibold [&_input]:tabular-nums"
          data-autofocus
        />
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">Paid via</legend>
          <div className="grid grid-cols-3 gap-2">
            {CHANNELS.map((c) => (
              <OptionButton key={c} pressed={channel === c} onClick={() => setChannel(c)}>
                {PAYMENT_CHANNEL_LABELS[c]}
              </OptionButton>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-2.5">
          <TextField
            label="Date received"
            type="date"
            max={todayIso()}
            min={loan.terms.disbursedOn ?? undefined}
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
            required
          />
          <TextField
            label="Transaction ID"
            placeholder="e.g. MP261112.1432"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            autoComplete="off"
          />
        </div>
        {preview ? (
          <p
            className="m-0 rounded-control bg-paid-row p-3 text-[13px] leading-snug text-success-fg"
            role="status"
          >
            {preview}
          </p>
        ) : null}
        <FormError>{error}</FormError>
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={Boolean(amountError) || !receivedOn}>
            {busy ? 'Saving…' : 'Save payment'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RestructureModal({ loan, onClose }: { loan: LoanDetail; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const remaining = loan.figures.remainingCount;
  const terms = [remaining + 6, remaining + 12, remaining + 18];
  const [type, setType] = useState<'EXTEND_TERM' | 'PAYMENT_HOLIDAY'>('EXTEND_TERM');
  const [term, setTerm] = useState(terms[0]!);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The same calculator the server uses, so the preview is the real figure.
  const input = {
    outstandingPrincipal: BigInt(loan.figures.outstandingPrincipal),
    annualRateBps: loan.terms.annualRateBps,
    currentInstalment: BigInt(loan.terms.instalment),
    remainingMonths: remaining,
  };
  const extend = type === 'EXTEND_TERM';
  const quote = extend ? quoteExtendTerm(input, term) : quotePaymentHoliday(input);
  const nextDue = loan.next ? formatDate(loan.next.dueDate) : 'the next due date';
  const note = extend
    ? `Instalment drops by ${formatRwf(-quote.instalmentChange)} a month. The borrower pays about ${formatRwf(quote.extraInterest)} more interest in total.`
    : `No payment on ${nextDue}. That month’s interest (${formatRwf(monthlyInterest(input.outstandingPrincipal, input.annualRateBps))}) is added to the balance and spread over the remaining ${remaining} instalments.`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/loans/${loan.code}/restructures`, {
        method: 'POST',
        body: { type, newTermMonths: extend ? term : undefined, reason: reason.trim() },
      });
      toast('Restructure request sent for approval.');
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
      title="Restructure loan"
      subtitle={`${formatRwf(input.outstandingPrincipal)} outstanding · ${remaining} instalments left`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">Option</legend>
          <OptionButton
            pressed={extend}
            hint="Lower instalments, more interest overall"
            onClick={() => setType('EXTEND_TERM')}
          >
            Extend the term
          </OptionButton>
          <OptionButton
            pressed={!extend}
            hint={`Skip ${loan.next ? formatDate(loan.next.dueDate, { year: false }) : 'the next instalment'}, interest still accrues`}
            onClick={() => setType('PAYMENT_HOLIDAY')}
          >
            One-month payment holiday
          </OptionButton>
        </fieldset>
        {extend ? (
          <div className="flex flex-col gap-2">
            <span id="rs-term" className="text-[13px] font-medium text-ink-soft">
              New remaining term
            </span>
            <div role="group" aria-labelledby="rs-term" className="grid grid-cols-3 gap-2">
              {terms.map((m) => (
                <OptionButton key={m} pressed={term === m} onClick={() => setTerm(m)}>
                  {m} months
                </OptionButton>
              ))}
            </div>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex flex-col gap-1 rounded-panel bg-ground p-3.5">
            <span className="text-xs text-ink-muted">Current instalment</span>
            <Money
              amount={input.currentInstalment}
              className="font-display text-xl font-semibold"
            />
          </div>
          <div className="flex flex-col gap-1 rounded-panel bg-forest p-3.5 text-white">
            <span className="text-xs text-forest-muted">New instalment</span>
            <Money
              amount={quote.newInstalment}
              className="font-display text-xl font-semibold text-lime"
            />
          </div>
        </div>
        <p className="m-0 text-[13px] leading-snug text-ink-soft" role="status">
          {note} Needs a manager’s approval.
        </p>
        <TextAreaField
          label="Reason"
          placeholder="e.g. Slow season, orders pick up in January"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <FormError>{error}</FormError>
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={reason.trim().length < 3}>
            Send for approval
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Shown while a restructure waits for a decision. Managers other than the requester can decide. */
export function RestructureBanner({ loan, me }: { loan: LoanDetail; me: Me }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = loan.pendingRestructure!;
  const isManager = me.role === 'MANAGER' || me.role === 'ADMIN';
  const own = request.requestedById === me.id;

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api(`/restructures/${request.id}/decide`, { method: 'POST', body: { approve } });
      toast(
        approve
          ? 'Restructure approved. The schedule has been rebuilt.'
          : 'Restructure request rejected.',
      );
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Restructure awaiting approval"
      className="flex flex-wrap items-center gap-4 rounded-[18px] border border-line bg-warning-bg px-[18px] py-4 text-warning-fg"
    >
      <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-1">
        <span className="text-sm font-semibold">
          {request.type === 'EXTEND_TERM'
            ? `Restructure awaiting approval: extend to ${request.newTermMonths} months`
            : 'Restructure awaiting approval: one-month payment holiday'}
        </span>
        <span className="text-[13px]">
          Instalment would go from {formatRwf(BigInt(request.previousInstalment))} to{' '}
          {formatRwf(BigInt(request.newInstalment))}. Requested by {request.requestedBy ?? 'staff'}
          {request.reason ? `: “${request.reason}”` : '.'}
        </span>
        {error ? (
          <span role="alert" className="text-[13px] font-semibold text-danger-fg">
            {error}
          </span>
        ) : null}
      </div>
      {isManager && !own ? (
        <>
          <Button variant="secondary" loading={busy} onClick={() => decide(false)}>
            Reject
          </Button>
          <Button loading={busy} onClick={() => decide(true)}>
            Approve restructure
          </Button>
        </>
      ) : (
        <span className="text-[13px]">
          {own ? 'Someone else must approve your request.' : 'A manager must approve this.'}
        </span>
      )}
    </section>
  );
}
