'use client';

import { Button } from '@kora/ui';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { TwoFactorChallenge } from '@/lib/types';
import { useCooldown } from './two-factor-setup';

/** What to tell someone at the code step of sign-in. */
export function codeStepHint(challenge: TwoFactorChallenge, appName: string): string {
  return challenge.method === 'sms'
    ? `We sent a 6-digit code to ${challenge.sentTo ?? 'your phone'}. It expires in 5 minutes.`
    : `Open your authenticator app and enter the 6-digit code for ${appName}.`;
}

/** "Send again" for texted sign-in codes, with a short wait between sends. */
export function ResendCode({
  path,
  challenge,
  onSent,
  onError,
}: {
  path: '/auth/2fa/resend' | '/platform/auth/2fa/resend';
  challenge: TwoFactorChallenge;
  onSent: (sentTo: string) => void;
  onError: (message: string) => void;
}) {
  // The first code went out with the sign-in itself, so the wait starts now.
  const cooldown = useCooldown(30, true);
  const [busy, setBusy] = useState(false);
  if (challenge.method !== 'sms') return null;

  async function resend() {
    setBusy(true);
    try {
      const res = await api<{ sentTo: string }>(path, {
        method: 'POST',
        body: { challengeToken: challenge.challengeToken },
        retryOnUnauthorized: false,
      });
      onSent(res.sentTo);
      cooldown.start();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant="ghost" block onClick={resend} loading={busy} disabled={cooldown.left > 0}>
      {cooldown.left > 0 ? `Send the code again in ${cooldown.left}s` : 'Send the code again'}
    </Button>
  );
}
