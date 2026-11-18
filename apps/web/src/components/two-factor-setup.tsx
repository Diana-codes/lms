'use client';

import { Button, FormError, OptionButton, TextField } from '@kora/ui';
import QRCode from 'qrcode';
import { type FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { TwoFactorMethod } from '@/lib/types';

/** Where the setup calls go: staff ('/auth') or platform admins ('/platform/auth'). */
export type AuthBase = '/auth' | '/platform/auth';

export const codeInputProps = {
  inputMode: 'numeric',
  autoComplete: 'one-time-code',
  pattern: '[0-9]{6}',
  maxLength: 6,
  required: true,
} as const;

const message = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Try again.';

/** Seconds left before "send again" is allowed, counting down once a second. */
export function useCooldown(seconds: number, startNow = false) {
  const [left, setLeft] = useState(startNow ? seconds : 0);
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);
  return { left, start: () => setLeft(seconds) };
}

/** Pick a method, then set it up. Text messages are the default. */
export function TwoFactorSetup({
  base,
  appIssuer,
  onDone,
}: {
  base: AuthBase;
  /** The name the authenticator app will show, e.g. "Bridge to Finance". */
  appIssuer: string;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<TwoFactorMethod>('sms');
  return (
    <div className="flex flex-col gap-5">
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1.5 text-[13px] font-medium text-ink-soft">
          How should we check it’s you?
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <OptionButton
            pressed={method === 'sms'}
            onClick={() => setMethod('sms')}
            hint="A 6-digit code by SMS each time you sign in"
          >
            Text message
          </OptionButton>
          <OptionButton
            pressed={method === 'app'}
            onClick={() => setMethod('app')}
            hint="Google Authenticator, 1Password or similar. Works offline and is harder to intercept."
          >
            Authenticator app
          </OptionButton>
        </div>
      </fieldset>
      {method === 'sms' ? (
        <SmsSetup base={base} onDone={onDone} />
      ) : (
        <AppSetup base={base} issuer={appIssuer} onDone={onDone} />
      )}
    </div>
  );
}

/** Confirm a phone number by texting it a code. Sign-in codes go there afterwards. */
export function SmsSetup({
  base,
  onDone,
  submitLabel = 'Confirm and continue',
}: {
  base: AuthBase;
  onDone: () => void;
  submitLabel?: string;
}) {
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'confirm' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cooldown = useCooldown(30);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    setBusy('send');
    setError(null);
    try {
      const res = await api<{ sentTo: string }>(`${base}/2fa/sms/start`, {
        method: 'POST',
        body: { phone },
      });
      setSentTo(res.sentTo);
      setCode('');
      cooldown.start();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setBusy('confirm');
    setError(null);
    try {
      await api(`${base}/2fa/sms/confirm`, { method: 'POST', body: { code } });
      onDone();
    } catch (err) {
      setError(message(err));
      setBusy(null);
    }
  }

  if (!sentTo) {
    return (
      <form onSubmit={send} className="flex max-w-sm flex-col gap-4" noValidate>
        <TextField
          label="Mobile number"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="078 812 3412"
          hint="A Rwandan number that receives SMS. Sign-in codes are sent here."
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          data-autofocus
        />
        <FormError>{error}</FormError>
        <Button
          type="submit"
          className="self-start"
          loading={busy === 'send'}
          disabled={phone.replace(/\D/g, '').length < 9}
        >
          Text me a code
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={confirm} className="flex max-w-sm flex-col gap-4" noValidate>
      <p className="m-0 text-sm">
        We sent a 6-digit code to <strong>{sentTo}</strong>. It expires in 5 minutes.
      </p>
      <TextField
        label="6-digit code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        autoFocus
        {...codeInputProps}
      />
      <FormError>{error}</FormError>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={busy === 'confirm'} disabled={code.length !== 6}>
          {submitLabel}
        </Button>
        <Button
          variant="ghost"
          onClick={() => send()}
          loading={busy === 'send'}
          disabled={cooldown.left > 0}
        >
          {cooldown.left > 0 ? `Send again in ${cooldown.left}s` : 'Send again'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setSentTo(null);
            setError(null);
          }}
        >
          Change number
        </Button>
      </div>
    </form>
  );
}

/** Set up an authenticator app: scan a QR code, then prove it works. */
export function AppSetup({
  base,
  issuer,
  onDone,
}: {
  base: AuthBase;
  issuer: string;
  onDone: () => void;
}) {
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ secret: string; otpauthUrl: string }>(`${base}/2fa/setup`, {
        method: 'POST',
      });
      // The QR code is drawn in the browser; the secret is not sent anywhere else.
      const qrSvg = await QRCode.toString(res.otpauthUrl, { type: 'svg', margin: 1, width: 180 });
      setSetup({ secret: res.secret, qrSvg });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function enable(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/2fa/enable`, { method: 'POST', body: { code } });
      onDone();
    } catch (err) {
      setError(message(err));
      setBusy(false);
    }
  }

  if (!setup) {
    return (
      <div className="flex flex-col gap-4">
        <p className="m-0 text-sm text-ink-muted">
          You need an authenticator app on your phone. It will show a new code for {issuer} every 30
          seconds.
        </p>
        <FormError>{error}</FormError>
        <Button className="self-start" onClick={begin} loading={busy}>
          Show the QR code
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={enable} className="flex flex-col gap-4" noValidate>
      <ol className="m-0 flex list-decimal flex-col gap-4 pl-5 text-sm">
        <li>
          Scan this code with your authenticator app.
          <div
            role="img"
            aria-label="QR code for your authenticator app"
            className="mt-3 w-fit rounded-control border border-line bg-white p-2"
            dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
          />
          <p className="mt-3 mb-0 text-[13px] text-ink-muted">
            Can’t scan it? Type this key into the app instead:
          </p>
          <code className="mt-1 block w-fit rounded-control bg-ground px-3 py-2 font-mono text-[13px] break-all">
            {setup.secret.match(/.{1,4}/g)?.join(' ')}
          </code>
        </li>
        <li>
          Enter the 6-digit code the app shows.
          <TextField
            className="mt-3 max-w-[220px]"
            label="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            {...codeInputProps}
          />
        </li>
      </ol>
      <FormError>{error}</FormError>
      <Button type="submit" className="self-start" loading={busy} disabled={code.length !== 6}>
        Turn on
      </Button>
    </form>
  );
}
