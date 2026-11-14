'use client';

import { Button, Card, FormError, TextField } from '@kora/ui';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';

export function PlatformLoginForm({ apiDown }: { apiDown: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    apiDown ? 'The server is not responding. Try again in a moment.' : null,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/platform/auth/login', {
        method: 'POST',
        body: { email, password },
        retryOnUnauthorized: false,
      });
      window.location.assign('/platform');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <Card className="gap-5">
      <h1 className="m-0 font-display text-[26px] font-semibold tracking-[-0.02em]">Sign in</h1>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <FormError>{error}</FormError>
        <Button type="submit" block loading={busy} disabled={!email || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </Card>
  );
}
