'use client';

import {
  formatBps,
  FREQUENCY_LABELS,
  PAYMENT_CHANNEL_LABELS,
  type PaymentChannel,
  scoreLabel,
} from '@kora/core';
import {
  AiPanel,
  Button,
  FormError,
  Modal,
  Money,
  OptionButton,
  Pill,
  TextAreaField,
  TextField,
  useToast,
} from '@kora/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { cardAge, termLine } from '@/lib/format';
import type { ApplicationCard, Me } from '@/lib/types';

type Mode = 'view' | 'decline' | 'disburse' | 'override';
const CHANNELS: PaymentChannel[] = ['MTN_MOMO', 'BANK_TRANSFER', 'CASH'];

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="m-0 text-sm font-semibold">{children}</dd>
    </div>
  );
}

/** One application, with the actions its stage and the user's role allow. */
export function ApplicationDialog({
  card,
  me,
  now,
  onClose,
}: {
  card: ApplicationCard | null;
  me: Me;
  now: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('view');
  const [reason, setReason] = useState('');
  const [channel, setChannel] = useState<PaymentChannel>('MTN_MOMO');
  const [collateral, setCollateral] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode('view');
    setReason('');
    setCollateral('');
    setChannel('MTN_MOMO');
    setError(null);
    setBusy(false);
  }, [card?.code]);

  if (!card) return null;
  const code = card.code;
  const canDecide = me.role !== 'COLLECTIONS_AGENT';
  const canDisburse = me.role === 'MANAGER' || me.role === 'ADMIN';
  const awaitingSecond = card.firstApprovalBy != null;

  async function run(
    path: string,
    body: object | undefined,
    done: (result: unknown) => string,
    close = false,
  ) {
    setBusy(true);
    setError(null);
    try {
      const result = await api<unknown>(`/applications/${code}${path}`, {
        method: 'POST',
        body: body ?? {},
      });
      toast(done(result));
      if (close) onClose();
      else setMode('view');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const move = (to: string, message: string, close = false) =>
    run('/move', { to, reason: reason.trim() || undefined }, () => message, close);
  const flagged = card.ai?.recommendation === 'FLAG';
  const approve = () =>
    flagged && mode !== 'override'
      ? setMode('override')
      : run('/approve', mode === 'override' ? { overrideReason: reason.trim() } : undefined, (r) =>
          (r as ApplicationCard).stage === 'APPROVED'
            ? `${code} approved.`
            : `First approval recorded. ${code} now needs a manager’s approval.`,
        );

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={card.borrowerName}
      subtitle={`${code} · ${card.productName}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={card.stage === 'APPROVED' || card.stage === 'DISBURSED' ? 'success' : 'info'}>
          {card.stageLabel}
        </Pill>
        <span className="text-[13px] text-ink-muted">{cardAge(card, now)}</span>
        <Link href={`/borrowers/${card.borrowerCode}`} className="ml-auto text-sm font-semibold">
          Borrower profile
        </Link>
      </div>

      <dl className="m-0 grid grid-cols-2 gap-x-5 gap-y-3.5 sm:grid-cols-3">
        <Fact label="Amount">
          <Money amount={card.amount} />
        </Fact>
        <Fact label="Term and rate">{termLine(card)}</Fact>
        <Fact label="Monthly instalment">
          <Money amount={card.instalment} />
        </Fact>
        <Fact label="Credit score">
          {card.score != null ? `${card.score} · ${scoreLabel(card.score)}` : 'Not scored yet'}
        </Fact>
        <Fact label="Documents">
          {card.docsReceived} of {card.docsRequired} received
        </Fact>
        <Fact label="Officer">{card.officerName ?? 'Unassigned'}</Fact>
      </dl>

      {!card.ai && canDecide && card.stage !== 'DISBURSED' && card.stage !== 'APPROVED' ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={busy}
          onClick={() => run('/score', undefined, () => `${code} scored.`)}
        >
          Score now
        </Button>
      ) : null}
      {card.ai ? (
        <AiPanel
          title="AI recommendation"
          meta={card.ai.modelVersion}
          className="gap-2 rounded-panel p-4"
        >
          <span className="font-semibold">{card.ai.title}</span>
          {card.ai.why ? <span className="block">Why: {card.ai.why}</span> : null}
          <span className="mt-1 block text-xs text-ai-ink-soft">
            Advice only. The decision is yours.
          </span>
          {canDecide &&
          (card.stage === 'NEW' ||
            card.stage === 'UNDER_REVIEW' ||
            card.stage === 'CREDIT_CHECK') ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => run('/score', undefined, () => `${code} scored again.`)}
              className="mt-2 min-h-9 cursor-pointer rounded-nav border border-ai-edge bg-surface px-3 text-xs font-semibold text-ai-ink"
            >
              Score again
            </button>
          ) : null}
        </AiPanel>
      ) : null}

      {awaitingSecond ? (
        <p className="m-0 rounded-control bg-info-bg px-3.5 py-2.5 text-sm text-info-fg">
          First approval by {card.firstApprovalBy!.name}. This amount needs a second approval from a
          manager.
        </p>
      ) : card.needsSecondApproval &&
        (card.stage === 'UNDER_REVIEW' || card.stage === 'CREDIT_CHECK') ? (
        <p className="m-0 text-[13px] text-ink-muted">
          This amount needs two approvals: an officer, then a manager.
        </p>
      ) : null}
      {card.declineReason ? <p className="m-0 text-sm">Declined: {card.declineReason}</p> : null}
      {card.disbursement?.status === 'FAILED' && card.stage === 'APPROVED' ? (
        <p className="m-0 rounded-control bg-danger-bg px-3.5 py-2.5 text-sm text-danger-fg">
          The MoMo transfer failed{card.disbursement.reason ? `: ${card.disbursement.reason}` : ''}.
          Loan {card.loanCode} is waiting; you can send it again.
        </p>
      ) : null}
      {card.disbursement &&
      (card.disbursement.status === 'PENDING' || card.disbursement.status === 'SENT') ? (
        <p className="m-0 rounded-control bg-info-bg px-3.5 py-2.5 text-sm text-info-fg">
          MoMo transfer in progress for loan {card.loanCode}. It activates once MoMo confirms.
        </p>
      ) : null}

      {mode === 'override' ? (
        <TextAreaField
          label="Why are you approving a flagged application?"
          placeholder="e.g. Checked bank statements; revenue confirmed"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-autofocus
        />
      ) : null}

      {mode === 'decline' ? (
        <TextAreaField
          label="Reason for declining"
          placeholder="e.g. Income could not be verified"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-autofocus
        />
      ) : null}

      {mode === 'disburse' ? (
        <div className="flex flex-col gap-3.5">
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">Sent via</legend>
            <div className="grid grid-cols-3 gap-2">
              {CHANNELS.map((c) => (
                <OptionButton key={c} pressed={channel === c} onClick={() => setChannel(c)}>
                  {PAYMENT_CHANNEL_LABELS[c]}
                </OptionButton>
              ))}
            </div>
          </fieldset>
          <TextField
            label="Collateral (optional)"
            placeholder="e.g. Equipment lien"
            value={collateral}
            onChange={(e) => setCollateral(e.target.value)}
          />
          <p className="m-0 rounded-control bg-paid-row px-3 py-2.5 text-[13px] leading-snug text-success-fg">
            {channel === 'MTN_MOMO' ? (
              <>
                Sends <Money amount={card.netDisbursed} /> to the borrower’s MoMo wallet. The loan
                starts, and the ledger is posted, once MoMo confirms the transfer.
              </>
            ) : (
              <>
                Records that <Money amount={card.netDisbursed} /> has been paid out, creates the
                loan and its repayment schedule, and posts it to the ledger.
              </>
            )}{' '}
            {card.netDisbursed !== card.amount ? (
              <>
                That is the <Money amount={card.amount} /> borrowed less fees taken at payout. The
                APR is {formatBps(card.aprBps, 2)}.{' '}
              </>
            ) : null}
            {card.instalmentCount} {FREQUENCY_LABELS[card.frequency].toLowerCase()} instalments of{' '}
            <Money amount={card.instalment} />.
          </p>
        </div>
      ) : null}

      <FormError>{error}</FormError>

      <div className="flex flex-wrap justify-end gap-2.5">
        {mode === 'override' ? (
          <>
            <Button variant="secondary" onClick={() => setMode('view')}>
              Back
            </Button>
            <Button loading={busy} disabled={reason.trim().length < 3} onClick={approve}>
              Approve with this reason
            </Button>
          </>
        ) : mode === 'decline' ? (
          <>
            <Button variant="secondary" onClick={() => setMode('view')}>
              Back
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={reason.trim().length < 3}
              onClick={() => move('DECLINED', `${code} declined.`, true)}
            >
              Decline application
            </Button>
          </>
        ) : mode === 'disburse' ? (
          <>
            <Button variant="secondary" onClick={() => setMode('view')}>
              Back
            </Button>
            <Button
              loading={busy}
              onClick={() =>
                run('/disburse', { channel, collateral: collateral.trim() || undefined }, (r) => {
                  const d = r as { loanCode: string; status?: string };
                  if (d.status === 'FAILED')
                    return `MoMo did not complete the transfer for ${d.loanCode}. You can try again.`;
                  if (d.status === 'PENDING')
                    return `Transfer for ${d.loanCode} sent to MoMo. It activates once confirmed.`;
                  return `Loan ${d.loanCode} created and disbursed.`;
                })
              }
            >
              Confirm disbursement
            </Button>
          </>
        ) : card.stage === 'DISBURSED' && card.loanCode ? (
          <Link href={`/loans/${card.loanCode}`} className="text-sm font-semibold">
            Open loan {card.loanCode}
          </Link>
        ) : !canDecide ? (
          <span className="text-[13px] text-ink-muted">
            Your role can view applications but not decide them.
          </span>
        ) : (
          <>
            {card.stage !== 'APPROVED' ? (
              <Button variant="secondary" disabled={busy} onClick={() => setMode('decline')}>
                Decline
              </Button>
            ) : null}
            {card.stage === 'NEW' ? (
              <Button
                loading={busy}
                onClick={() => move('UNDER_REVIEW', `${code} moved to Under review.`)}
              >
                Start review
              </Button>
            ) : null}
            {card.stage === 'UNDER_REVIEW' && !awaitingSecond ? (
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => move('CREDIT_CHECK', `${code} sent for a credit check.`)}
              >
                Send to credit check
              </Button>
            ) : null}
            {card.stage === 'CREDIT_CHECK' && !awaitingSecond ? (
              <Button
                variant="secondary"
                loading={busy}
                onClick={() => move('UNDER_REVIEW', `${code} moved back to Under review.`)}
              >
                Back to review
              </Button>
            ) : null}
            {card.stage === 'UNDER_REVIEW' || card.stage === 'CREDIT_CHECK' ? (
              <Button loading={busy} onClick={approve}>
                {awaitingSecond
                  ? 'Give second approval'
                  : card.needsSecondApproval
                    ? 'Approve (1 of 2)'
                    : 'Approve'}
              </Button>
            ) : null}
            {card.stage === 'APPROVED' ? (
              canDisburse ? (
                <Button onClick={() => setMode('disburse')}>Record disbursement</Button>
              ) : (
                <span className="text-[13px] text-ink-muted">
                  Approved. A manager records the disbursement.
                </span>
              )
            ) : null}
          </>
        )}
      </div>
    </Modal>
  );
}
