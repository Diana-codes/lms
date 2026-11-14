'use client';

import { Button, Card, FormError, TextField } from '@kora/ui';
import { type FormEvent, useState } from 'react';
import { codeStepHint, ResendCode } from '@/components/sign-in-code';
import { codeInputProps } from '@/components/two-factor-setup';
import { api, ApiError } from '@/lib/api';
import { PRODUCT_NAME } from '@/lib/config';
import type { TwoFactorChallenge } from '@/lib/types';

type LoginResult = { status: 'OK' } | TwoFactorChallenge;

export function PlatformLoginForm({ apiDown }: { apiDown: boolean }) {
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
        ? await api<LoginResult>('/platform/auth/2fa/verify', {
            method: 'POST',
            body: { challengeToken: challenge.challengeToken, code },
            retryOnUnauthorized: false,
          })
        : await api<LoginResult>('/platform/auth/login', {
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
            {codeStepHint(challenge, `the ${PRODUCT_NAME} platform`)}
          </p>
        ) : null}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {challenge ? (
          <TextField
            key="code"
            label="6-digit code"
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
          <>
            <ResendCode
              path="/platform/auth/2fa/resend"
              challenge={challenge}
              onSent={(sentTo) => {
                setError(null);
                setCode('');
                setNotice(`A new code is on its way to ${sentTo}.`);
              }}
              onError={setError}
            />
            <Button
              variant="ghost"
              block
              onClick={() => {
                setChallenge(null);
                setCode('');
                setError(null);
                setNotice(null);
              }}
            >
              Start again
            </Button>
          </>
        ) : null}
      </form>
    </Card>
  );
}
