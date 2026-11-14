'use client';

import { Button, Card, CardTitle, FormError, Pill } from '@kora/ui';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

/** Issue a new webhook secret. It is shown once; the old one stops working. */
export function WebhookSecret({
  companyId,
  configured,
}: {
  companyId: string;
  configured: boolean;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rotate() {
    if (
      configured &&
      !window.confirm(
        'Issue a new webhook secret? MoMo and SMS callbacks using the old one will stop working until the new one is in place.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ webhookToken: string }>(
        `/platform/companies/${companyId}/webhook-token`,
        { method: 'POST' },
      );
      setToken(res.webhookToken);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Webhook secret</CardTitle>
        <Pill tone={configured || token ? 'success' : 'warning'}>
          {configured || token ? 'Set' : 'Not set'}
        </Pill>
      </div>
      <p className="m-0 text-sm text-ink-muted">
        Part of this company&apos;s MoMo and SMS callback addresses, so callbacks reach the right
        lender. Stored encrypted; shown only when issued.
      </p>
      {token ? (
        <div className="flex flex-col gap-2 rounded-panel bg-caution-bg p-4 text-caution-ink">
          <strong className="text-sm">New secret: copy it now</strong>
          <code className="text-sm break-all">{token}</code>
        </div>
      ) : null}
      <FormError>{error}</FormError>
      <div>
        <Button type="button" variant="secondary" loading={busy} onClick={rotate}>
          {configured || token ? 'Issue a new secret' : 'Issue a secret'}
        </Button>
      </div>
    </Card>
  );
}
