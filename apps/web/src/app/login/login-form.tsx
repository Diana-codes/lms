'use client';

import { Button, Card, TextField } from '@kora/ui';
import { type FormEvent, useState } from 'react';
import { codeStepHint, ResendCode } from '@/components/sign-in-code';
import { codeInputProps } from '@/components/two-factor-setup';
import { api, ApiError } from '@/lib/api';
import type { LoginResponse, TwoFactorChallenge } from '@/lib/types';

export function LoginForm({
  next,
  apiDown,
  appName,
}: {
  next: string;
  apiDown: boolean;
  /** The lender's name, as the authenticator app shows it. */
  appName: string;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<TwoFactorChallenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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
            body: { challengeToken: challenge.challengeToken, code },
            retryOnUnauthorized: false,
          })
        : await api<LoginResponse>('/auth/login', {
            method: 'POST',
            body: { email, password },
            retryOnUnauthorized: false,
          });

      if (result.status === 'TWO_FACTOR_REQUIRED') {
        setChallenge(result);
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
    setNotice(null);
  }

  return (
    <Card className="w-full max-w-[400px] gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-display text-[26px] font-semibold tracking-[-0.02em]">
          {challenge ? 'Enter your code' : 'Sign in'}
        </h1>
        <p className="m-0 text-sm text-ink-muted">
          {challenge ? codeStepHint(challenge, appName) : 'Use your work email and password.'}
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {challenge ? (
          <TextField
            key="code"
            label="6-digit code"
            name="code"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            {...codeInputProps}
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

        {notice && !error ? (
          <p role="status" className="m-0 text-sm text-ink-muted">
            {notice}
          </p>
        ) : null}
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
          <>
            <ResendCode
              path="/auth/2fa/resend"
              challenge={challenge}
              onSent={(sentTo) => {
                setError(null);
                setCode('');
                setNotice(`A new code is on its way to ${sentTo}.`);
              }}
              onError={setError}
            />
            <Button variant="ghost" block onClick={startOver}>
              Use a different account
            </Button>
          </>
        ) : null}
      </form>
    </Card>
  );
}
