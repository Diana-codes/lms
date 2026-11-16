'use client';

import { formatDate, formatRwf } from '@kora/core';
import {
  Button,
  FormError,
  Money,
  SparkleIcon,
  TextAreaField,
  TextField,
  useToast,
} from '@kora/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { groupDigits, todayIso } from '@/lib/format';
import type { AiApproach, AiApproachResponse, CollectionsAccount } from '@/lib/types';

type Outcome = 'PROMISED_TO_PAY' | 'NO_ANSWER' | 'PAID_PART' | 'DISPUTED';
const OUTCOMES: Array<[Outcome, string]> = [
  ['PROMISED_TO_PAY', 'Promised to pay'],
  ['NO_ANSWER', 'No answer'],
  ['PAID_PART', 'Paid in part'],
  ['DISPUTED', 'Disputes amount'],
];
const message = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Try again.';

export function AccountPanel({ loanCode }: { loanCode: string }) {
  const router = useRouter();
  const toast = useToast();
  const [account, setAccount] = useState<CollectionsAccount | null>(null);
  const [failed, setFailed] = useState(false);
  const [approach, setApproach] = useState<AiApproach | null | 'loading' | 'unavailable'>(
    'loading',
  );
  const [draft, setDraft] = useState<{ text: string; lang: string } | null>(null);
  const [outcome, setOutcome] = useState<Outcome>('PROMISED_TO_PAY');
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<CollectionsAccount>(`/collections/accounts/${loanCode}`)
      .then((a) => {
        if (!live) return;
        setAccount(a);
        setAmount(groupDigits(a.overdue));
      })
      .catch(() => live && setFailed(true));
    api<AiApproachResponse>(`/ai/collections/${loanCode}/approach`)
      .then(
        (r) =>
          live && setApproach(r.approach ?? (r.reason === 'not_configured' ? null : 'unavailable')),
      )
      .catch(() => live && setApproach('unavailable'));
    return () => {
      live = false;
    };
  }, [loanCode]);

  if (failed)
    return (
      <aside className="flex-[1_1_320px] rounded-card border border-line bg-surface p-[22px] text-sm text-ink-muted">
        Couldn’t load this account.
      </aside>
    );
  if (!account)
    return (
      <aside className="flex-[1_1_320px] rounded-card border border-line bg-surface p-[22px] text-sm text-ink-muted">
        Loading…
      </aside>
    );

  async function refresh() {
    setAccount(await api<CollectionsAccount>(`/collections/accounts/${loanCode}`));
    router.refresh();
  }

  async function openDraft(lang: 'English' | 'Kinyarwanda') {
    try {
      const d = await api<{ english: string; kinyarwanda: string }>(
        `/collections/accounts/${loanCode}/drafts`,
      );
      if (lang === 'Kinyarwanda') return setDraft({ text: d.kinyarwanda, lang: 'Kinyarwanda' });
      setDraft({ text: d.english, lang: 'English' });
    } catch (err) {
      toast(message(err));
    }
  }

  async function sendSms() {
    if (!draft) return;
    setBusy('sms');
    try {
      const r = await api<{ status: string; failureReason: string | null }>(
        `/borrowers/${account!.borrowerCode}/sms`,
        {
          method: 'POST',
          body: {
            body: draft.text,
            loanCode,
            language: draft.lang.startsWith('Kinyarwanda') ? 'RW' : 'EN',
          },
        },
      );
      toast(
        r.status === 'FAILED'
          ? `SMS could not be sent: ${r.failureReason ?? 'not accepted'}`
          : `SMS sent to ${account!.name}.`,
      );
      setDraft(null);
      await refresh();
    } catch (err) {
      toast(message(err));
    } finally {
      setBusy(null);
    }
  }

  async function requestMomo() {
    setBusy('momo');
    try {
      await api(`/loans/${loanCode}/momo-request`, {
        method: 'POST',
        body: { amount: account!.overdue },
      });
      toast(
        `MoMo request for ${formatRwf(BigInt(account!.overdue))} sent to ${account!.name}’s phone.`,
      );
    } catch (err) {
      toast(message(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveOutcome(event: FormEvent) {
    event.preventDefault();
    setBusy('outcome');
    setError(null);
    try {
      const needsDate = outcome === 'PROMISED_TO_PAY' || outcome === 'NO_ANSWER';
      await api(`/collections/accounts/${loanCode}/outcome`, {
        method: 'POST',
        body: {
          outcome,
          channel: 'CALL',
          date: needsDate ? date : undefined,
          amount: outcome === 'PROMISED_TO_PAY' ? amount.replace(/,/g, '') : undefined,
        },
      });
      toast(`Outcome saved for ${account!.name}.`);
      await refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  const needsDate = outcome === 'PROMISED_TO_PAY' || outcome === 'NO_ANSWER';

  return (
    <aside
      aria-label="Selected account"
      className="flex min-w-0 flex-[1_1_320px] flex-col gap-4 rounded-card border border-line bg-surface p-[22px]"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-12 flex-none items-center justify-center rounded-panel bg-forest font-semibold text-lime">
          {account.initials}
        </span>
        <div className="mr-auto flex min-w-0 flex-col">
          <Link
            href={`/loans/${loanCode}`}
            className="truncate font-display text-lg font-semibold text-ink no-underline hover:underline"
          >
            {account.name}
          </Link>
          <span className="text-xs text-ink-muted">
            {loanCode} · {account.phone}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-0.5 rounded-panel bg-[#FBE9E1] p-3">
          <span className="text-xs text-[#7A2A0E]">Overdue</span>
          <Money
            amount={account.overdue}
            className="font-display text-lg font-semibold text-[#5A1C06]"
          />
        </div>
        <div className="flex flex-col gap-0.5 rounded-panel bg-ground p-3">
          <span className="text-xs text-ink-muted">Outstanding</span>
          <Money amount={account.outstanding} className="font-display text-lg font-semibold" />
        </div>
      </div>
      {account.promise ? (
        <p className="m-0 rounded-control bg-warning-bg px-3 py-2 text-[13px] text-warning-fg">
          Promised {formatRwf(BigInt(account.promise.amount))} by {formatDate(account.promise.date)}
          .
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <a
          href={`tel:${account.phone.replace(/[^\d+]/g, '')}`}
          className="flex h-11 items-center justify-center gap-2 rounded-control bg-ink text-sm font-semibold text-white no-underline hover:text-white"
          aria-disabled="true"
          onClick={(e) => e.preventDefault()}
          title="Calls go through your phone; log the result below"
        >
          Call
        </a>
        <Button variant="secondary" onClick={() => openDraft('English')}>
          Send SMS
        </Button>
      </div>
      {account.momoLinked ? (
        <Button variant="secondary" loading={busy === 'momo'} onClick={requestMomo}>
          Request {formatRwf(BigInt(account.overdue))} via MoMo
        </Button>
      ) : null}

      <div className="flex flex-col gap-2.5 rounded-panel bg-ai-tint p-3.5 text-ai-ink">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold">
          <SparkleIcon size={14} />
          AI suggested approach
        </span>
        {approach === 'loading' ? (
          <span className="text-[13px] text-ai-ink-soft">Thinking…</span>
        ) : approach === 'unavailable' || approach === null ? (
          <span className="text-[13px] text-ai-ink-soft">
            {approach === null
              ? 'Not available: the AI service is not configured. Use the contact log and your judgement.'
              : 'The AI service did not answer just now. Use the contact log and your judgement.'}
          </span>
        ) : (
          <>
            <div className="flex flex-col gap-1.5 text-[13px] leading-snug">
              <span>
                <span className="font-semibold">Best time:</span> {approach.bestTime}
              </span>
              <span>
                <span className="font-semibold">Offer:</span> {approach.offer}
              </span>
              <span className="text-ai-ink-soft">{approach.odds}</span>
            </div>
            <Button
              variant="secondary"
              className="h-9 self-start border-ai-edge text-[13px] text-ai-ink"
              onClick={() => openDraft('Kinyarwanda')}
            >
              Draft SMS in Kinyarwanda
            </Button>
            <span className="text-[11px] text-ai-ink-soft">
              Advice from {approach.model}. It does not decide anything.
            </span>
          </>
        )}
      </div>

      {draft ? (
        <div className="flex flex-col gap-2.5 rounded-panel border border-line p-3">
          <TextAreaField
            label={`SMS to ${account.phone} · ${draft.lang}`}
            rows={4}
            maxLength={480}
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button loading={busy === 'sms'} onClick={sendSms} disabled={!draft.text.trim()}>
              Send SMS
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5">
        <h2 className="m-0 text-sm font-semibold">Contact log</h2>
        {account.log.length === 0 ? (
          <span className="text-[13px] text-ink-muted">No contact yet.</span>
        ) : null}
        {account.log.slice(0, 6).map((l) => (
          <div key={l.id} className="flex gap-2.5 text-[13px]">
            <span className="mt-[5px] size-2 flex-none rounded-full bg-[#A7ADA3]" />
            <span className="flex flex-col gap-0.5">
              <span>{l.text}</span>
              <span className="text-xs text-ink-muted">{l.when}</span>
            </span>
          </div>
        ))}
      </div>

      <form onSubmit={saveOutcome} noValidate>
        <fieldset className="m-0 flex flex-col gap-2.5 rounded-panel border border-line p-3.5">
          <legend className="px-1.5 text-sm font-semibold">Log outcome</legend>
          <div className="grid grid-cols-2 gap-2 text-[13px]">
            {OUTCOMES.map(([key, label]) => (
              <label key={key} className="flex min-h-8 items-center gap-2">
                <input
                  type="radio"
                  name="outcome"
                  checked={outcome === key}
                  onChange={() => setOutcome(key)}
                />
                {label}
              </label>
            ))}
          </div>
          {outcome === 'PROMISED_TO_PAY' ? (
            <TextField
              label="Amount promised (RWF)"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(groupDigits(e.target.value))}
            />
          ) : null}
          {needsDate ? (
            <TextField
              label={outcome === 'PROMISED_TO_PAY' ? 'Promise date' : 'Call again on'}
              type="date"
              min={todayIso()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          ) : null}
          <FormError>{error}</FormError>
          <Button variant="accent" loading={busy === 'outcome'} type="submit">
            Save outcome
          </Button>
        </fieldset>
      </form>
    </aside>
  );
}
