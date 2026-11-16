'use client';

import { Button, Card, CardTitle, FormError, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { CompanySettings } from '@/lib/types';

/** Staff 2FA and borrower SMS OTP — off until this company's admins switch them on. */
export function AuthFeaturesForm({ settings }: { settings: CompanySettings }) {
  const router = useRouter();
  const toast = useToast();
  const [staffTwoFactor, setStaffTwoFactor] = useState(settings.features.staffTwoFactor);
  const [borrowerOtp, setBorrowerOtp] = useState(settings.features.borrowerOtp);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/company/settings', {
        method: 'PATCH',
        body: { staffTwoFactor, borrowerOtp },
      });
      toast('Sign-in settings saved');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>Sign-in security</CardTitle>
      <p className="m-0 text-sm text-ink-muted">
        Off by default so you can try the product quickly. Switch them on before going live with
        real borrowers and staff.
      </p>
      <form onSubmit={save} className="flex flex-col gap-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={staffTwoFactor}
            onChange={(e) => setStaffTwoFactor(e.target.checked)}
          />
          <span>
            <span className="font-medium">Staff two-factor sign-in</span>
            <span className="block text-ink-muted">
              Password plus a texted code or authenticator app. Required for every staff account when
              on.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={borrowerOtp}
            onChange={(e) => setBorrowerOtp(e.target.checked)}
          />
          <span>
            <span className="font-medium">Borrower SMS sign-in code</span>
            <span className="block text-ink-muted">
              App and portal send a 6-digit code by SMS. When off, a known phone number is enough.
            </span>
          </span>
        </label>
        <FormError>{error}</FormError>
        <Button type="submit" loading={busy} className="self-start">
          Save sign-in settings
        </Button>
      </form>
    </Card>
  );
}
