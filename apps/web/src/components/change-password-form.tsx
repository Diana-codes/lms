'use client';

import { Button, FormError, TextField } from '@kora/ui';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';

export const MIN_PASSWORD_LENGTH = 12;

/** Change your own password: current one, then the new one twice. */
export function ChangePasswordForm({
  submitLabel = 'Change password',
  currentLabel = 'Current password',
  onDone,
}: {
  submitLabel?: string;
  currentLabel?: string;
  onDone: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = next.length < MIN_PASSWORD_LENGTH;
  const mismatch = repeat !== next;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!current || tooShort || mismatch) return;
    setBusy(true);
    setError(null);
    try {
      await api('/auth/password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      setCurrent('');
      setNext('');
      setRepeat('');
      setTouched(false);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-4" noValidate>
      <TextField
        label={currentLabel}
        type="password"
        autoComplete="current-password"
        required
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        error={touched && !current ? 'Enter your current password' : null}
      />
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. A short sentence works well.`}
        value={next}
        onChange={(e) => setNext(e.target.value)}
        error={touched && tooShort ? `Use at least ${MIN_PASSWORD_LENGTH} characters` : null}
      />
      <TextField
        label="New password again"
        type="password"
        autoComplete="new-password"
        required
        value={repeat}
        onChange={(e) => setRepeat(e.target.value)}
        error={touched && !tooShort && mismatch ? 'The two passwords differ' : null}
      />
      <FormError>{error}</FormError>
      <Button type="submit" className="self-start" loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}
