'use client';

import { Button, Card, CardTitle, FormError, Pill, TextField, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { AppSetup, codeInputProps, SmsSetup } from '@/components/two-factor-setup';
import { api, ApiError } from '@/lib/api';
import type { TwoFactorMethod } from '@/lib/types';

type Panel = 'phone' | 'app' | 'toSms' | null;

/**
 * Two-factor sign-in is required, so this card changes how it works rather
 * than turning it off: a new phone number, or text messages versus an app.
 */
export function TwoFactorCard({
  method,
  verifiedPhone,
  appIssuer,
}: {
  method: TwoFactorMethod | null;
  verifiedPhone: string | null;
  appIssuer: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [panel, setPanel] = useState<Panel>(null);

  function done(message: string) {
    setPanel(null);
    toast(message);
    router.refresh();
  }

  return (
    <Card className="max-w-2xl">
      <div className="flex flex-wrap items-center gap-3">
        <CardTitle className="mr-auto">Two-factor sign-in</CardTitle>
        <Pill tone="success">{method === 'app' ? 'Authenticator app' : 'Text message'}</Pill>
      </div>
      <p className="m-0 text-sm text-ink-muted">
        {method === 'app'
          ? 'After your password, you enter the 6-digit code your authenticator app shows.'
          : `After your password, we text a 6-digit code to ${verifiedPhone ?? 'your phone'}.`}
        {method === 'app' && verifiedPhone
          ? ` Your confirmed number for text messages is ${verifiedPhone}.`
          : null}
      </p>

      {panel === null ? (
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => setPanel('phone')}>
            {verifiedPhone ? 'Change phone number' : 'Add a phone for text messages'}
          </Button>
          {method === 'sms' ? (
            <Button variant="secondary" onClick={() => setPanel('app')}>
              Use an authenticator app instead
            </Button>
          ) : null}
          {method === 'app' && verifiedPhone ? (
            <Button variant="secondary" onClick={() => setPanel('toSms')}>
              Switch to text messages
            </Button>
          ) : null}
        </div>
      ) : null}

      {panel === 'phone' ? (
        <>
          <SmsSetup
            base="/auth"
            submitLabel="Confirm number"
            onDone={() =>
              done(
                method === 'app'
                  ? 'Phone confirmed. You can now switch to text messages.'
                  : 'Phone confirmed. Sign-in codes go there from now on.',
              )
            }
          />
          <Button variant="ghost" className="self-start" onClick={() => setPanel(null)}>
            Cancel
          </Button>
        </>
      ) : null}

      {panel === 'app' ? (
        <>
          <AppSetup
            base="/auth"
            issuer={appIssuer}
            onDone={() => done('Authenticator app is on. Sign-in now asks for its code.')}
          />
          <Button variant="ghost" className="self-start" onClick={() => setPanel(null)}>
            Cancel
          </Button>
        </>
      ) : null}

      {panel === 'toSms' ? (
        <SwitchToSms
          onCancel={() => setPanel(null)}
          onDone={() => done(`Sign-in codes now come by text to ${verifiedPhone}.`)}
        />
      ) : null}
    </Card>
  );
}

/** Stop using the app (codes then come by text): needs the password and an app code. */
function SwitchToSms({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/2fa/disable', { method: 'POST', body: { password, code } });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-4" noValidate>
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <TextField
        label="Code from your authenticator app"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        {...codeInputProps}
      />
      <FormError>{error}</FormError>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={busy} disabled={!password || code.length !== 6}>
          Switch to text messages
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
