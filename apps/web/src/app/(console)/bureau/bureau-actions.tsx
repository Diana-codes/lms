'use client';

import { addMonths } from '@kora/core';
import { Button, FormError, TextAreaField, TextField, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { todayIso } from '@/lib/format';
import type { BureauSubmissionRow } from './types';

const message = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Try again.';

/** Build (or rebuild) the file for a finished month. */
export function GenerateForm({ lastLenderCode }: { lastLenderCode: string | null }) {
  const router = useRouter();
  const lastMonth = addMonths(todayIso(), -1).slice(0, 7);
  const [month, setMonth] = useState(lastMonth);
  const [lenderCode, setLenderCode] = useState(lastLenderCode ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const row = await api<BureauSubmissionRow>('/bureau/submissions', {
        method: 'POST',
        body: { month, lenderCode },
      });
      router.push(`/bureau/${row.id}`);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="flex flex-wrap gap-3">
        <TextField
          label="Month"
          type="month"
          max={lastMonth}
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="max-w-[200px]"
        />
        <TextField
          label="Your member code at the bureau"
          value={lenderCode}
          onChange={(e) => setLenderCode(e.target.value.toUpperCase())}
          maxLength={20}
          className="max-w-[220px]"
        />
      </div>
      <FormError>{error}</FormError>
      <Button
        type="submit"
        loading={busy}
        disabled={!month || !lenderCode.trim()}
        className="self-start"
      >
        Build file
      </Button>
    </form>
  );
}

/** Download, mark as sent, and record the bureau's answer. */
export function SubmissionActions({ row, canAct }: { row: BureauSubmissionRow; canAct: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [rejected, setRejected] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, path: string, body: object, done: string) {
    setBusy(key);
    setError(null);
    try {
      await api(path, { method: 'POST', body });
      toast(done);
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  if (!canAct) return null;
  return (
    <div className="flex flex-col gap-3">
      <a
        href={`/api/bureau/submissions/${row.id}/file`}
        className="inline-flex h-11 items-center self-start rounded-[10px] border border-line px-4 text-sm font-semibold no-underline"
      >
        Download file
      </a>
      <p className="m-0 text-xs text-ink-muted">
        The file holds full national IDs. Upload it straight to the bureau’s portal and delete your
        local copy; every download is logged.
      </p>

      {row.status === 'GENERATED' ? (
        <form
          className="flex flex-col gap-3 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              'submit',
              `/bureau/submissions/${row.id}/submitted`,
              { reference },
              'Marked as sent.',
            );
          }}
        >
          <TextField
            label="Upload reference from the bureau"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={80}
            className="max-w-[320px]"
          />
          <Button
            type="submit"
            loading={busy === 'submit'}
            disabled={reference.trim().length < 2}
            className="self-start"
          >
            Mark as sent
          </Button>
        </form>
      ) : null}

      {row.status === 'SUBMITTED' ? (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <p className="m-0 text-sm font-semibold">The bureau’s answer</p>
          <TextField
            label="Records rejected (if any)"
            inputMode="numeric"
            value={rejected}
            onChange={(e) => setRejected(e.target.value.replace(/\D/g, ''))}
            className="max-w-[200px]"
          />
          <TextAreaField
            label="What the bureau said"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              loading={busy === 'accept'}
              onClick={() =>
                run(
                  'accept',
                  `/bureau/submissions/${row.id}/response`,
                  { accepted: true, note: note || undefined },
                  'Recorded as accepted.',
                )
              }
            >
              Accepted
            </Button>
            <Button
              type="button"
              variant="secondary"
              loading={busy === 'reject'}
              onClick={() =>
                run(
                  'reject',
                  `/bureau/submissions/${row.id}/response`,
                  {
                    accepted: false,
                    rejectedCount: rejected ? Number(rejected) : undefined,
                    note,
                  },
                  'Recorded as rejected. Fix the records and build a correction file.',
                )
              }
            >
              Rejected
            </Button>
          </div>
        </div>
      ) : null}
      <FormError>{error}</FormError>
    </div>
  );
}
