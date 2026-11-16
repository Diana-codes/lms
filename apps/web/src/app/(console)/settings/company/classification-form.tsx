'use client';

import { Button, Card, CardTitle, FormError, SelectField, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { CompanySettings, CreditClassProfile } from '@/lib/types';

const OPTIONS: Array<{ value: CreditClassProfile; label: string; hint: string }> = [
  {
    value: 'COMPANY',
    label: 'Deposit-taking microfinance company',
    hint: 'Watch from 30 days, substandard from 90, doubtful from 180, loss from 365.',
  },
  {
    value: 'COOPERATIVE',
    label: 'Deposit-taking microfinance cooperative',
    hint: 'Watch from 1 day, substandard from 30, doubtful from 90, loss from 180.',
  },
];

/** Which BNR 59/2023 DPD schedule the nightly classification uses. */
export function ClassificationForm({ settings }: { settings: CompanySettings }) {
  const router = useRouter();
  const toast = useToast();
  const [profile, setProfile] = useState<CreditClassProfile>(settings.creditClassProfile);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = OPTIONS.find((o) => o.value === profile)!;

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/company/settings', {
        method: 'PATCH',
        body: { creditClassProfile: profile },
      });
      toast('Classification schedule saved. It applies on the next nightly run.');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>Credit classification (BNR 59/2023)</CardTitle>
      <p className="m-0 text-sm text-ink-muted">
        The Central Bank uses different day bands for companies and cooperatives.
        Provisions follow the same five classes: 1%, 5%, 25%, 50%, 100%.
      </p>
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <SelectField
            label="Institution type"
            value={profile}
            onChange={(e) => setProfile(e.target.value as CreditClassProfile)}
          >
            {OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
          <p className="m-0 text-xs text-ink-muted">{selected.hint}</p>
        </div>
        <FormError>{error}</FormError>
        <Button type="submit" disabled={busy || profile === settings.creditClassProfile}>
          {busy ? 'Saving…' : 'Save schedule'}
        </Button>
      </form>
    </Card>
  );
}
