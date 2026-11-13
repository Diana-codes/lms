'use client';

import { Button, SparkleIcon, useToast } from '@kora/ui';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { EarlyWarning } from '@/lib/types';

/** Up-to-date borrowers the scoring rules think may miss their next payment. */
export function EarlyWarningBanner() {
  const toast = useToast();
  const [data, setData] = useState<EarlyWarning | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    api<EarlyWarning>('/ai/early-warning')
      .then((d) => {
        setData(d);
        setSent(Boolean(d.checkInsSent));
      })
      .catch(() => setData({ available: false, flagged: [], signals: [] }));
  }, []);

  async function checkIns() {
    setBusy(true);
    try {
      const r = await api<{ sent: number }>('/ai/early-warning/check-ins', { method: 'POST' });
      setSent(true);
      toast(
        r.sent
          ? `Friendly check-in SMS sent to ${r.sent} ${r.sent === 1 ? 'borrower' : 'borrowers'}.`
          : 'Everyone flagged already had a check-in this week.',
      );
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const n = data?.flagged.length ?? 0;
  const examples = data?.flagged.slice(0, 3) ?? [];
  return (
    <section
      aria-label="AI early warning"
      className="flex flex-wrap items-center gap-4 rounded-[18px] border border-ai-line bg-ai-tint px-[18px] py-4"
    >
      <span className="flex size-10 flex-none items-center justify-center rounded-control bg-ai text-white">
        <SparkleIcon size={20} />
      </span>
      <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-[3px]">
        <span className="text-sm font-semibold text-ai-ink">
          {!data
            ? 'Early warning: checking…'
            : !data.available
              ? 'Early warning is not available: the scoring service is not answering'
              : n === 0
                ? 'Early warning: no up-to-date borrowers show warning signs today'
                : `Early warning: ${n} ${n === 1 ? 'borrower who is' : 'borrowers who are'} up to date ${n === 1 ? 'is' : 'are'} likely to miss their next payment`}
        </span>
        {data?.available && n > 0 ? (
          <span className="text-[13px] text-ai-ink-soft">
            Main signals:{' '}
            {data.signals
              .map((s) => `${s.text.charAt(0).toLowerCase()}${s.text.slice(1)} (${s.count})`)
              .join(', ')}
            . From {data.modelVersion}; advice only.
          </span>
        ) : null}
      </div>
      {n > 0 ? (
        <div
          className="flex items-center"
          aria-label={`Examples: ${examples.map((e) => e.name).join(', ')}${n > 3 ? ` and ${n - 3} more` : ''}`}
        >
          {examples.map((e, i) => (
            <span
              key={e.loanCode}
              title={`${e.name} · ${e.loanCode}: ${e.signals.join('; ')}`}
              className={`flex size-8 items-center justify-center rounded-full border-2 border-ai-tint bg-surface text-[11px] font-semibold text-ai-ink ${i ? '-ml-2' : ''}`}
            >
              {e.initials}
            </span>
          ))}
          {n > 3 ? (
            <span className="-ml-2 flex size-8 items-center justify-center rounded-full border-2 border-ai-tint bg-ai text-[11px] font-semibold text-white">
              +{n - 3}
            </span>
          ) : null}
        </div>
      ) : null}
      {n > 0 ? (
        <Button
          className="bg-ai text-[13px] hover:bg-ai-ink"
          loading={busy}
          disabled={sent}
          onClick={checkIns}
        >
          {sent ? 'Check-ins sent' : 'Send friendly check-ins'}
        </Button>
      ) : null}
    </section>
  );
}
