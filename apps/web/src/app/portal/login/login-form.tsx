'use client';

import { Button, FormError, TextField } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import {
  portalApi,
  portalErrorMessage,
  savePortalTokens,
  type PortalTokens,
} from '@/lib/portal/api';

type RequestCodeResult =
  | ({ otpRequired: false; phone: string } & PortalTokens)
  | { otpRequired: true; sent: true; phone: string };

export function PortalLoginForm({ lenderName }: { lenderName: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [masked, setMasked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await portalApi<RequestCodeResult>('/app/auth/request-code', {
        method: 'POST',
        body: { phone },
        auth: false,
      });
      if (r.otpRequired === false) {
        savePortalTokens(r);
        router.replace('/portal/home');
        return;
      }
      setMasked(r.phone);
      setBusy(false);
    } catch (err) {
      setError(portalErrorMessage(err));
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      savePortalTokens(
        await portalApi<PortalTokens>('/app/auth/verify', {
          method: 'POST',
          body: { phone, code },
          auth: false,
        }),
      );
      router.replace('/portal/home');
    } catch (err) {
      setError(portalErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={masked ? verify : requestCode}
      className="flex flex-col gap-4"
      noValidate
    >
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-display text-2xl font-semibold tracking-[-0.02em]">
          {masked ? 'Enter your code' : 'Sign in with your phone'}
        </h1>
        <p className="m-0 text-sm text-ink-muted">
          {masked
            ? `We sent a 6-digit code by SMS to ${masked}.`
            : `Enter the phone number on your ${lenderName} account. You may get a texted code if your lender requires one.`}
        </p>
      </div>

      {masked ? (
        <TextField
          label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.35em' }}
          autoFocus
        />
      ) : (
        <TextField
          label="Phone number"
          inputMode="tel"
          autoComplete="tel"
          placeholder="078 812 3412"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoFocus
        />
      )}

      <FormError>{error}</FormError>

      <Button
        type="submit"
        disabled={busy || (masked ? code.length !== 6 : phone.replace(/\D/g, '').length < 9)}
      >
        {busy ? 'One moment…' : masked ? 'Sign in' : 'Continue'}
      </Button>

      {masked ? (
        <button
          type="button"
          className="self-start text-sm font-semibold text-forest underline-offset-2 hover:underline"
          onClick={() => {
            setMasked(null);
            setCode('');
            setError(null);
          }}
        >
          Use a different number
        </button>
      ) : null}
    </form>
  );
}
