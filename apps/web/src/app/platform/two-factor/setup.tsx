'use client';

import { Button, Card, FormError, TextField } from '@kora/ui';
import QRCode from 'qrcode';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';

export function PlatformTwoFactorSetup() {
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ secret: string; otpauthUrl: string }>('/platform/auth/2fa/setup', {
        method: 'POST',
      });
      // The QR code is drawn in the browser; the secret is not sent anywhere else.
      const qrSvg = await QRCode.toString(res.otpauthUrl, { type: 'svg', margin: 1, width: 180 });
      setSetup({ secret: res.secret, qrSvg });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function enable(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/platform/auth/2fa/enable', { method: 'POST', body: { code } });
      window.location.assign('/platform');
    } catch (err) {
      fail(err);
      setBusy(false);
    }
  }

  async function signOut() {
    await api('/platform/auth/logout', { method: 'POST', retryOnUnauthorized: false }).catch(
      () => undefined,
    );
    window.location.assign('/platform/login');
  }

  return (
    <Card className="gap-5">
      {!setup ? (
        <>
          <p className="m-0 text-sm">
            You need an authenticator app on your phone, such as Google Authenticator, Microsoft
            Authenticator or 1Password.
          </p>
          <FormError>{error}</FormError>
          <div className="flex flex-wrap gap-3">
            <Button onClick={begin} loading={busy}>
              Set up two-factor
            </Button>
            <Button variant="ghost" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </>
      ) : (
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
                Can&apos;t scan it? Type this key into the app instead:
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
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </li>
          </ol>
          <FormError>{error}</FormError>
          <div>
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              Turn on and continue
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
