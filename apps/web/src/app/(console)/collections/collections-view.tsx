'use client';

import { formatBps } from '@kora/core';
import { Button, cx, Money, useToast } from '@kora/ui';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { count, longDate } from '@/lib/format';
import type { ArrearsBucket, CollectionsQueue, Me } from '@/lib/types';
import { AccountPanel } from './account-panel';
import { EarlyWarningBanner } from './early-warning';

type Tab = 'ALL' | ArrearsBucket;
const TABS: Array<[Tab, string]> = [
  ['ALL', 'All'],
  ['DPD_1_30', '1–30 days'],
  ['DPD_31_90', '31–90 days'],
  ['DPD_90_PLUS', '90+ days'],
];
const NEXT_PILL: Record<string, string> = {
  FIELD_VISIT: 'bg-danger-bg text-danger-fg',
  FOLLOW_UP: 'bg-warning-bg text-warning-fg',
  CALL: 'bg-info-bg text-info-fg',
  SMS: 'bg-neutral-bg text-neutral-fg',
  WAIT: 'bg-neutral-bg text-neutral-fg',
};
const BAR: Record<ArrearsBucket, string> = {
  DPD_1_30: 'bg-lime-deep',
  DPD_31_90: 'bg-amber',
  DPD_90_PLUS: 'bg-rust',
};

function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  tone?: 'forest';
}) {
  const dark = tone === 'forest';
  return (
    <div
      className={cx(
        'flex flex-col gap-2 rounded-[18px] p-[18px]',
        dark ? 'bg-forest text-white' : 'border border-line bg-surface',
      )}
    >
      <span className={cx('text-xs', dark ? 'text-forest-muted' : 'text-ink-muted')}>{label}</span>
      <span
        className={cx('font-display text-[26px] leading-tight font-semibold', dark && 'text-lime')}
      >
        {value}
      </span>
      {note ? (
        <span className={cx('text-xs', dark ? 'text-forest-muted' : 'text-ink-muted')}>{note}</span>
      ) : null}
    </div>
  );
}

export function CollectionsView({
  queue,
  me,
  initialOpen,
  initialBucket,
}: {
  queue: CollectionsQueue;
  me: Me;
  initialOpen: string | null;
  initialBucket: Tab;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(initialBucket);
  const [selected, setSelected] = useState<string | null>(
    initialOpen ?? queue.items[0]?.loanCode ?? null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const isManager = me.role === 'MANAGER' || me.role === 'ADMIN';
  const shown = queue.items.filter((i) => tab === 'ALL' || i.bucket === tab);
  const total = (t: Tab) => (t === 'ALL' ? queue.items.length : queue.buckets[t]);

  useEffect(() => {
    if (selected && !shown.some((i) => i.loanCode === selected))
      setSelected(shown[0]?.loanCode ?? null);
  }, [tab, shown, selected]);

  async function run(key: string, work: () => Promise<string>) {
    setBusy(key);
    try {
      toast(await work());
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  }

  const bulkSms = () =>
    run('sms', async () => {
      const r = await api<{ sent: number; skipped: number }>('/collections/bulk-sms', {
        method: 'POST',
        body: { bucket: tab },
      });
      return r.sent === 0 && r.skipped > 0
        ? `Everyone in this tab was already texted today.`
        : `Reminder SMS sent to ${r.sent} ${r.sent === 1 ? 'account' : 'accounts'}${r.skipped ? ` (${r.skipped} already texted today)` : ''}.`;
    });
  const assign = () =>
    run('assign', async () => {
      const r = await api<{ assigned: number; perPerson: Array<{ name: string; count: number }> }>(
        '/collections/assign',
        { method: 'POST' },
      );
      if (r.assigned === 0) return 'Every account already has someone assigned.';
      return `Accounts assigned: ${r.perPerson.map((p) => `${p.count} to ${p.name}`).join(', ')}.`;
    });

  return (
    <>
      <header className="flex flex-wrap items-end gap-4">
        <div className="mr-auto flex flex-col gap-1">
          <span className="text-[13px] text-ink-muted">
            {isManager ? 'Whole book' : 'Your queue'} · {longDate(queue.asOf)}
          </span>
          <h1 className="m-0 font-display text-[30px] leading-tight font-semibold tracking-[-0.02em]">
            Collections
          </h1>
        </div>
        <Button
          variant="secondary"
          loading={busy === 'sms'}
          onClick={bulkSms}
          disabled={shown.length === 0}
        >
          Bulk SMS
        </Button>
        {isManager ? (
          <Button loading={busy === 'assign'} onClick={assign}>
            Assign accounts
          </Button>
        ) : null}
      </header>

      <section
        aria-label="Collection metrics"
        className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5"
      >
        <Metric
          label="Accounts in arrears"
          value={count(queue.metrics.inArrears)}
          note={
            <span className="font-medium text-caution-fg">
              {queue.metrics.newThisWeek
                ? `+${queue.metrics.newThisWeek} this week`
                : 'None new this week'}
            </span>
          }
        />
        <Metric
          label="Balance at risk (30+ days)"
          value={<Money amount={queue.metrics.balanceAtRisk} compact />}
          note={`${formatBps(queue.metrics.atRiskBps)} of portfolio`}
        />
        <Metric
          label="Promises to pay · this week"
          value={count(queue.metrics.promisesThisWeek)}
          note={
            <>
              <Money amount={queue.metrics.promisedAmount} compact /> promised
            </>
          }
        />
        <Metric
          tone="forest"
          label="Recovered this month"
          value={<Money amount={queue.metrics.recoveredThisMonth} compact />}
          note="From accounts that were in arrears"
        />
      </section>

      <EarlyWarningBanner />

      <div className="flex flex-wrap items-start gap-4">
        <section className="flex min-w-0 flex-[2_1_560px] flex-col gap-3.5 rounded-card border border-line bg-surface p-5">
          <div role="tablist" aria-label="Days past due" className="flex flex-wrap gap-1.5">
            {TABS.map(([key, label]) => {
              const on = tab === key;
              return (
                <button
                  key={key}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setTab(key)}
                  className={cx(
                    'flex h-11 cursor-pointer items-center gap-2 rounded-nav px-3 text-[13px]',
                    on
                      ? 'border-0 bg-forest font-semibold text-white'
                      : 'border border-line bg-surface text-ink-soft',
                  )}
                >
                  {label}
                  <span
                    className={cx(
                      'rounded-pill px-[7px] py-px text-[11px]',
                      on ? 'bg-lime text-forest' : 'bg-neutral-bg text-neutral-fg',
                    )}
                  >
                    {total(key)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="overflow-x-auto">
            <div className="flex min-w-[640px] flex-col">
              <div className="grid grid-cols-[2.2fr_1.3fr_1.2fr_1.3fr_1fr] gap-3 border-b border-line px-3 py-2 text-xs text-ink-muted">
                <span>Borrower</span>
                <span>Days late</span>
                <span className="text-right">Overdue</span>
                <span>Last contact</span>
                <span>Next step</span>
              </div>
              {shown.length === 0 ? (
                <p className="m-0 p-6 text-center text-sm text-ink-muted">
                  No accounts in this bucket. Good news.
                </p>
              ) : null}
              {shown.map((r) => {
                const on = r.loanCode === selected;
                return (
                  <button
                    key={r.loanCode}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSelected(r.loanCode)}
                    className={cx(
                      'grid min-h-[60px] cursor-pointer grid-cols-[2.2fr_1.3fr_1.2fr_1.3fr_1fr] items-center gap-3 rounded-control border-0 border-b border-line-soft p-3 text-left text-sm text-ink',
                      on
                        ? 'bg-paid-row shadow-[inset_3px_0_0_var(--color-forest)]'
                        : 'bg-surface hover:bg-ground',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-[34px] flex-none items-center justify-center rounded-full bg-avatar-bg text-xs font-semibold text-forest">
                        {r.initials}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold">{r.name}</span>
                        <span className="text-xs text-ink-muted">{r.loanCode}</span>
                      </span>
                    </span>
                    <span className="flex flex-col gap-1.5">
                      <span className="font-semibold">
                        {r.dpd} {r.dpd === 1 ? 'day' : 'days'}
                      </span>
                      <span className="h-[5px] rounded-pill bg-neutral-bg">
                        <span
                          className={cx('block h-[5px] rounded-pill', BAR[r.bucket])}
                          style={{ width: `${Math.min(100, Math.round((r.dpd / 120) * 100))}%` }}
                        />
                      </span>
                    </span>
                    <Money amount={r.overdue} className="text-right font-semibold" />
                    <span className="text-[13px] text-ink-soft">{r.lastContact}</span>
                    <span>
                      <span
                        className={cx(
                          'inline-block rounded-pill px-[9px] py-[3px] text-xs font-semibold whitespace-nowrap',
                          NEXT_PILL[r.nextAction],
                        )}
                      >
                        {r.nextActionLabel}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
        {selected ? <AccountPanel key={selected} loanCode={selected} /> : null}
      </div>
    </>
  );
}
