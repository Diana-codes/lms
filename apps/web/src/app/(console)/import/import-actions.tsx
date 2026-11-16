'use client';

import { Button, FormError, TextField, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { todayIso } from '@/lib/format';

const message = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Try again.';

export function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [asOf, setAsOf] = useState(todayIso());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('file', file);
    form.append('asOf', asOf);
    try {
      const batch = await api<{ id: string }>('/migration/batches', { method: 'POST', body: form });
      router.push(`/import/${batch.id}`);
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-line pt-3">
      <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-soft">
        Spreadsheet (.xlsx or .csv)
        <input
          type="file"
          accept=".xlsx,.csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
      </label>
      <TextField
        label="Cut-over date (balances are as of this day)"
        type="date"
        max={todayIso()}
        value={asOf}
        onChange={(e) => setAsOf(e.target.value)}
        className="max-w-[260px]"
      />
      <FormError>{error}</FormError>
      <Button type="submit" loading={busy} disabled={!file} className="self-start">
        Check file
      </Button>
    </form>
  );
}

export function BatchActions({
  id,
  status,
  canImport,
  canSignOff,
  allMatch,
}: {
  id: string;
  status: string;
  canImport: boolean;
  canSignOff: boolean;
  allMatch: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(path: string, done: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/migration/batches/${id}/${path}`, { method: 'POST' });
      toast(done);
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {status === 'VALIDATED' && canImport ? (
        <Button loading={busy} onClick={() => run('import', 'Loans imported.')}>
          Import these loans
        </Button>
      ) : null}
      {status === 'IMPORTED' && canSignOff ? (
        <Button
          loading={busy}
          disabled={!allMatch}
          onClick={() => run('sign-off', 'Migration signed off.')}
        >
          Sign off reconciliation
        </Button>
      ) : null}
      <FormError>{error}</FormError>
    </div>
  );
}
