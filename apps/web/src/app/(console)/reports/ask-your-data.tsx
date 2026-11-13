'use client';

import { Button, cx, SparkleIcon } from '@kora/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { AiStatus, AskAnswer } from '@/lib/types';

const SUGGESTIONS = [
  'Which product had the highest share of balance more than 30 days late?',
  'How many loans did each officer disburse in the last 3 months?',
  'How much is due in each of the next 4 weeks?',
];

/**
 * "Ask your data": a manager's question becomes SQL over the reporting views,
 * runs on a read-only login, and comes back as a short answer. The query is
 * always shown, so anyone can check what was counted.
 */
export function AskYourData() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AiStatus>('/ai/status')
      .then(setStatus)
      .catch(() => setStatus({ configured: false, model: null, askYourData: false }));
  }, []);

  async function ask(text: string) {
    const q = text.trim();
    if (q.length < 5) return;
    setQuestion(q);
    setBusy(true);
    setError(null);
    try {
      setAnswer(await api<AskAnswer>('/ai/ask', { method: 'POST', body: { question: q } }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setAnswer(null);
    } finally {
      setBusy(false);
    }
  }

  const off = status != null && !status.askYourData;
  const max = answer?.ok ? Math.max(1, ...answer.bars.map((b) => Math.abs(b.value))) : 1;

  return (
    <section
      aria-label="Ask your data"
      className="flex flex-col gap-3.5 rounded-card border border-ai-line bg-ai-tint p-5"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-nav bg-ai text-white">
          <SparkleIcon size={16} />
        </span>
        <label htmlFor="ask" className="mr-auto font-display text-base font-semibold text-ai-ink">
          Ask your data
        </label>
        <span className="text-xs text-ai-ink-soft">Answers in English, Kinyarwanda or French</span>
      </div>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <input
          id="ask"
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={off}
          maxLength={300}
          placeholder={
            off
              ? 'Not available: the AI service or the reporting login is not configured'
              : 'e.g. Which district has the most loans more than 30 days late?'
          }
          className="h-11 min-w-0 flex-[1_1_320px] rounded-control border border-ai-line bg-surface px-3.5 text-sm text-ink placeholder:text-ink-muted disabled:bg-ground"
        />
        <Button
          type="submit"
          loading={busy}
          disabled={off || question.trim().length < 5}
          className="bg-ai hover:bg-ai-ink"
        >
          Ask
        </Button>
      </form>
      {!off ? (
        <div role="group" aria-label="Suggested questions" className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void ask(s)}
              disabled={busy}
              className={cx(
                'min-h-9 cursor-pointer rounded-pill border px-3.5 text-[13px]',
                answer && answer.question === s
                  ? 'border-ai bg-surface font-semibold text-ai-ink'
                  : 'border-line bg-surface text-ink-soft hover:border-ai-edge',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-bg px-3.5 py-2.5 text-sm text-danger-fg"
        >
          {error}
        </p>
      ) : null}
      {busy ? (
        <p className="m-0 text-[13px] text-ai-ink-soft" role="status">
          Working it out…
        </p>
      ) : null}
      {answer && !busy ? (
        <div className="flex flex-wrap gap-5 rounded-panel bg-surface p-4" role="status">
          {answer.ok ? (
            <>
              <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1.5">
                <span className="font-display text-lg font-semibold text-ink">
                  {answer.headline}
                </span>
                <span className="text-sm leading-relaxed text-ink-soft">{answer.body}</span>
                <span className="text-xs text-ink-muted">
                  {answer.source} · written by {answer.model}; check before you rely on it
                </span>
              </div>
              {answer.bars.length ? (
                <div
                  role="img"
                  aria-label={`${answer.headline}: ${answer.bars.map((b) => `${b.label} ${b.value}${answer.unit}`).join(', ')}`}
                  className="flex min-w-0 flex-[1_1_260px] flex-col gap-2"
                >
                  {answer.bars.map((b, i) => (
                    <div
                      key={b.label}
                      className="grid grid-cols-[110px_1fr_auto] items-center gap-2 text-[13px]"
                    >
                      <span className="truncate">{b.label}</span>
                      <span className="h-3 rounded-pill bg-neutral-bg">
                        <span
                          className={cx(
                            'block h-3 rounded-pill',
                            i === 0 ? 'bg-ai' : 'bg-[#A693E0]',
                          )}
                          style={{ width: `${(Math.abs(b.value) / max) * 100}%` }}
                        />
                      </span>
                      <span className="font-semibold tabular-nums">
                        {b.value.toLocaleString('en-US')}
                        {answer.unit}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <p className="m-0 text-sm text-ink">{answer.error}</p>
          )}
          <details className="w-full text-xs text-ink-muted">
            <summary className="cursor-pointer font-semibold">The query behind this answer</summary>
            <pre className="mt-2 overflow-x-auto rounded-control bg-ground p-3 font-mono whitespace-pre-wrap text-ink">
              {answer.sql}
            </pre>
            <span>
              Run on a read-only login that can only see the reporting views (no names, phone or ID
              numbers).
            </span>
          </details>
        </div>
      ) : null}
    </section>
  );
}
