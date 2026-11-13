'use client';

import { Button, Card, TextField } from '@kora/ui';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { LoginResponse } from '@/lib/types';

export function LoginForm({ next, apiDown }: { next: string; apiDown: boolean }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    apiDown ? 'The server is not responding. Try again in a moment.' : null,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = challenge
        ? await api<LoginResponse>('/auth/2fa/verify', {
            method: 'POST',
            body: { challengeToken: challenge, code },
            retryOnUnauthorized: false,
          })
        : await api<LoginResponse>('/auth/login', {
            method: 'POST',
            body: { email, password },
            retryOnUnauthorized: false,
          });

      if (result.status === 'TOTP_REQUIRED') {
        setChallenge(result.challengeToken);
        setPassword('');
        setBusy(false);
        return;
      }
      // A full page load, so the server renders the console with the new session.
      window.location.assign(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  function startOver() {
    setChallenge(null);
    setCode('');
    setError(null);
  }

  return (
    <Card className="w-full max-w-[400px] gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-display text-[26px] font-semibold tracking-[-0.02em]">
          {challenge ? 'Enter your code' : 'Sign in'}
        </h1>
        <p className="m-0 text-sm text-ink-muted">
          {challenge
            ? 'Open your authenticator app and enter the 6-digit code for Kora Lend.'
            : 'Use your work email and password.'}
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {challenge ? (
          <TextField
            key="code"
            label="6-digit code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        ) : (
          <>
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
          </>
        )}

        {error ? (
          <p
            role="alert"
            className="m-0 rounded-control bg-danger-bg px-3.5 py-2.5 text-sm text-danger-fg"
          >
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          block
          loading={busy}
          disabled={challenge ? code.length !== 6 : !email || !password}
        >
          {busy ? 'Signing in…' : challenge ? 'Verify and sign in' : 'Sign in'}
        </Button>
        {challenge ? (
          <Button variant="ghost" block onClick={startOver}>
            Use a different account
          </Button>
        ) : null}
      </form>
    </Card>
  );
}
