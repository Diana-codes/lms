'use client';

import { Button, Card, CardTitle, Pill, TextField, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';

interface Setup {
  secret: string;
  qrSvg: string;
}

const codeProps = {
  inputMode: 'numeric',
  autoComplete: 'one-time-code',
  pattern: '[0-9]{6}',
  maxLength: 6,
  required: true,
} as const;

export function TwoFactorCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');

  function reset() {
    setSetup(null);
    setTurningOff(false);
    setCode('');
    setPassword('');
    setError(null);
  }

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ secret: string; otpauthUrl: string }>('/auth/2fa/setup', {
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
      await api('/auth/2fa/enable', { method: 'POST', body: { code } });
      reset();
      toast('Two-factor sign-in is on.');
      router.refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function disable(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/2fa/disable', { method: 'POST', body: { password, code } });
      reset();
      toast('Two-factor sign-in is off.');
      router.refresh();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  const errorBox = error ? (
    <p
      role="alert"
      className="m-0 rounded-control bg-danger-bg px-3.5 py-2.5 text-sm text-danger-fg"
    >
      {error}
    </p>
  ) : null;

  return (
    <Card className="max-w-2xl">
      <div className="flex flex-wrap items-center gap-3">
        <CardTitle className="mr-auto">Two-factor sign-in</CardTitle>
        <Pill tone={enabled ? 'success' : 'warning'}>{enabled ? 'On' : 'Off'}</Pill>
      </div>
      <p className="m-0 text-sm text-ink-muted">
        After your password, you enter a 6-digit code from an authenticator app on your phone. It
        stops someone who has learned your password from signing in as you.
      </p>

      {!enabled && !setup ? (
        <>
          {errorBox}
          <Button className="self-start" onClick={begin} loading={busy}>
            Set up two-factor
          </Button>
        </>
      ) : null}

      {!enabled && setup ? (
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
                {...codeProps}
              />
            </li>
          </ol>
          {errorBox}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              Turn on
            </Button>
            <Button variant="secondary" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {enabled && !turningOff ? (
        <Button variant="secondary" className="self-start" onClick={() => setTurningOff(true)}>
          Turn off two-factor
        </Button>
      ) : null}

      {enabled && turningOff ? (
        <form onSubmit={disable} className="flex max-w-sm flex-col gap-4" noValidate>
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <TextField
            label="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            {...codeProps}
          />
          {errorBox}
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              variant="danger"
              loading={busy}
              disabled={!password || code.length !== 6}
            >
              Turn off
            </Button>
            <Button variant="secondary" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
