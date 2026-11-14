'use client';

import { Button, Card, FormError, TextField } from '@kora/ui';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';

type LoginResult = { status: 'OK' } | { status: 'TOTP_REQUIRED'; challengeToken: string };

export function PlatformLoginForm({ apiDown }: { apiDown: boolean }) {
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
        ? await api<LoginResult>('/platform/auth/2fa/verify', {
            method: 'POST',
            body: { challengeToken: challenge, code },
            retryOnUnauthorized: false,
          })
        : await api<LoginResult>('/platform/auth/login', {
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
      window.location.assign('/platform');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <Card className="gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-display text-[26px] font-semibold tracking-[-0.02em]">
          {challenge ? 'Enter your code' : 'Sign in'}
        </h1>
        {challenge ? (
          <p className="m-0 text-sm text-ink-muted">
            Open your authenticator app and enter the 6-digit code for the Kora Lend platform.
          </p>
        ) : null}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {challenge ? (
          <TextField
            key="code"
            label="6-digit code"
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
        <FormError>{error}</FormError>
        <Button
          type="submit"
          block
          loading={busy}
          disabled={challenge ? code.length !== 6 : !email || !password}
        >
          {busy ? 'Signing in…' : challenge ? 'Verify and sign in' : 'Sign in'}
        </Button>
        {challenge ? (
          <Button
            variant="ghost"
            block
            onClick={() => {
              setChallenge(null);
              setCode('');
              setError(null);
            }}
          >
            Start again
          </Button>
        ) : null}
      </form>
    </Card>
  );
}
