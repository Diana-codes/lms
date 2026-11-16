'use client';

import { Button, Card, CardTitle, FormError, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { CompanySettings } from '@/lib/types';

/** PRD §3.5: maker-checker on disbursement, for teams large enough to split the work. */
export function SegregationForm({ settings }: { settings: CompanySettings }) {
  const router = useRouter();
  const toast = useToast();
  const [strict, setStrict] = useState(settings.features.strictSegregation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/company/settings', { method: 'PATCH', body: { strictSegregation: strict } });
      toast('Approval settings saved');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>Segregation of duties</CardTitle>
      <p className="m-0 text-sm text-ink-muted">
        Always on: nobody approves their own restructure, write-off or journal, and second approvals
        come from a different person.
      </p>
      <form onSubmit={save} className="flex flex-col gap-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={strict}
            onChange={(e) => setStrict(e.target.checked)}
          />
          <span>
            <span className="font-medium">Separate approval from disbursement</span>
            <span className="block text-ink-muted">
              Whoever approved a loan cannot also pay it out; another manager must disburse it. Turn
              on once you have at least two managers.
            </span>
          </span>
        </label>
        <FormError>{error}</FormError>
        <Button type="submit" loading={busy} className="self-start">
          Save approval settings
        </Button>
      </form>
    </Card>
  );
}
