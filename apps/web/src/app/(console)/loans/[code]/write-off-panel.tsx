'use client';

import { formatRwf, PAYMENT_CHANNEL_LABELS, type PaymentChannel, PAYMENT_ROLES } from '@kora/core';
import {
  Button,
  Card,
  FormError,
  Modal,
  Money,
  OptionButton,
  TextAreaField,
  TextField,
  useToast,
} from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { dateTime, groupDigits, todayIso } from '@/lib/format';
import type { LoanDetail, LoanWriteOffs, Me } from '@/lib/types';

const NON_PERFORMING = new Set(['SUBSTANDARD', 'DOUBTFUL', 'LOSS']);
const CHANNELS: PaymentChannel[] = ['MTN_MOMO', 'BANK_TRANSFER', 'CASH'];
const message = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Try again.';

/**
 * Write-off workflow on the loan page (PRD §6.13): request, a second
 * manager's decision, and recoveries after the loan is written off.
 */
export function WriteOffPanel({
  loan,
  me,
  data,
}: {
  loan: LoanDetail;
  me: Me;
  data: LoanWriteOffs;
}) {
  const router = useRouter();
  const toast = useToast();
  const [modal, setModal] = useState<'request' | 'recovery' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = data.requests.find((r) => r.status === 'PENDING');
  const approved = data.requests.find((r) => r.status === 'APPROVED');
  const canRequest =
    loan.status === 'ACTIVE' &&
    !pending &&
    NON_PERFORMING.has(loan.creditClass ?? '') &&
    (me.role === 'MANAGER' || me.role === 'ADMIN' || me.role === 'COLLECTIONS_AGENT');
  const canDecide =
    pending && (me.role === 'MANAGER' || me.role === 'ADMIN') && pending.requestedById !== me.id;
  const canRecover =
    loan.status === 'WRITTEN_OFF' && (PAYMENT_ROLES as readonly string[]).includes(me.role);

  if (!pending && !approved && !canRequest) return null;

  async function decide(approve: boolean) {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/write-offs/${pending.id}/decide`, { method: 'POST', body: { approve } });
      toast(approve ? `${loan.code} written off.` : 'Write-off request rejected.');
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-3 p-[22px]">
      <h2 className="m-0 font-display text-base font-semibold">Write-off</h2>
      {approved ? (
        <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-ink-muted">Written off</dt>
          <dd className="m-0 text-right font-semibold">
            {approved.decidedAt ? dateTime(approved.decidedAt) : '—'}
          </dd>
          <dt className="text-ink-muted">Principal</dt>
          <dd className="m-0 text-right font-semibold">
            <Money amount={approved.principal} />
          </dd>
          <dt className="text-ink-muted">Interest</dt>
          <dd className="m-0 text-right font-semibold">
            <Money amount={approved.interest} />
          </dd>
          <dt className="text-ink-muted">From the loss allowance</dt>
          <dd className="m-0 text-right font-semibold">
            <Money amount={approved.allowanceUsed} />
          </dd>
          <dt className="text-ink-muted">Recovered since</dt>
          <dd className="m-0 text-right font-semibold">
            <Money amount={data.recovered} />
          </dd>
        </dl>
      ) : null}
      {pending ? (
        <div className="flex flex-col gap-2 text-sm">
          <p className="m-0">
            Requested {dateTime(pending.requestedAt)}:{' '}
            <span className="font-semibold">{formatRwf(BigInt(pending.principal))}</span> principal.
          </p>
          <p className="m-0 text-ink-muted">“{pending.reason}”</p>
          {canDecide ? (
            <div className="flex gap-2">
              <Button loading={busy} onClick={() => decide(true)}>
                Approve write-off
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => decide(false)}>
                Reject
              </Button>
            </div>
          ) : (
            <p className="m-0 text-ink-muted">Waiting for a different manager to decide.</p>
          )}
        </div>
      ) : null}
      {canRequest ? (
        <>
          <p className="m-0 text-sm text-ink-muted">
            This loan is non-performing. A write-off removes it from the books; collection can
            continue and anything recovered is reported separately.
          </p>
          <Button variant="secondary" className="self-start" onClick={() => setModal('request')}>
            Request write-off
          </Button>
        </>
      ) : null}
      {canRecover ? (
        <Button className="self-start" onClick={() => setModal('recovery')}>
          Record recovery
        </Button>
      ) : null}
      <FormError>{error}</FormError>
      {modal === 'request' ? <RequestModal loan={loan} onClose={() => setModal(null)} /> : null}
      {modal === 'recovery' ? <RecoveryModal loan={loan} onClose={() => setModal(null)} /> : null}
    </Card>
  );
}

function RequestModal({ loan, onClose }: { loan: LoanDetail; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/loans/${loan.code}/write-off`, { method: 'POST', body: { reason } });
      toast('Write-off requested. A different manager must approve it.');
      onClose();
      router.refresh();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Request write-off" subtitle={loan.code}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="m-0 text-sm text-ink-muted">
          Outstanding principal: <Money amount={loan.figures.outstandingPrincipal} />. Approval
          posts it, with any accrued interest, against the loan-loss allowance and write-off
          expense.
        </p>
        <TextAreaField
          label="Why should this loan be written off?"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-autofocus
          required
        />
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={reason.trim().length < 10}>
            Send for approval
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RecoveryModal({ loan, onClose }: { loan: LoanDetail; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [channel, setChannel] = useState<PaymentChannel>('MTN_MOMO');
  const [receivedOn, setReceivedOn] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);
  const value = amount ? BigInt(amount.replace(/,/g, '')) : 0n;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/loans/${loan.code}/recoveries`, {
        method: 'POST',
        body: {
          amount: value.toString(),
          channel,
          receivedOn,
          reference: reference.trim() || undefined,
          idempotencyKey,
        },
      });
      toast(`Recovery of ${formatRwf(value)} recorded.`);
      onClose();
      router.refresh();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Record recovery" subtitle={`${loan.code} · written off`}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField
          label="Amount received (RWF)"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(groupDigits(e.target.value))}
          autoComplete="off"
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
            value={receivedOn}
            onChange={(e) => setReceivedOn(e.target.value)}
            required
          />
          <TextField
            label="Transaction ID"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            autoComplete="off"
          />
        </div>
        <FormError>{error}</FormError>
        <div className="flex justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={value === 0n || !receivedOn}>
            Save recovery
          </Button>
        </div>
      </form>
    </Modal>
  );
}
