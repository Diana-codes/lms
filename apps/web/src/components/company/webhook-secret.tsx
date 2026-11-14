'use client';

import { Button, Card, CardTitle, FormError, Pill } from '@kora/ui';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

interface Issued {
  webhookToken: string;
  urls: { momoCollection: string; momoDisbursement: string; smsDelivery: string };
}

const URL_LABELS: Array<[keyof Issued['urls'], string]> = [
  ['momoCollection', 'MTN MoMo collections callback'],
  ['momoDisbursement', 'MTN MoMo disbursements callback'],
  ['smsDelivery', "Africa's Talking delivery reports"],
];

/** Issue a new webhook secret. It is shown once, with the callback addresses; the old one stops working. */
export function WebhookSecret({
  endpoint,
  configured,
}: {
  /** The settings route: `/platform/companies/<id>` or `/company/settings`. */
  endpoint: string;
  configured: boolean;
}) {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rotate() {
    if (
      configured &&
      !window.confirm(
        'Issue a new webhook secret? MoMo and SMS callbacks using the old one will stop working until the new addresses are in place.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setIssued(await api<Issued>(`${endpoint}/webhook-token`, { method: 'POST' }));
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
        <Pill tone={configured || issued ? 'success' : 'warning'}>
          {configured || issued ? 'Set' : 'Not set'}
        </Pill>
      </div>
      <p className="m-0 text-sm text-ink-muted">
        Part of the callback addresses MTN MoMo and Africa&apos;s Talking use, so their callbacks
        reach the right lender. Stored encrypted; shown only when issued.
      </p>
      {issued ? (
        <div className="flex flex-col gap-3 rounded-panel bg-caution-bg p-4 text-caution-ink">
          <strong className="text-sm">New secret: copy the addresses now</strong>
          <code className="text-sm break-all">{issued.webhookToken}</code>
          <dl className="m-0 flex flex-col gap-2 text-[13px]">
            {URL_LABELS.map(([key, label]) => (
              <div key={key} className="flex flex-col gap-0.5">
                <dt className="font-semibold">{label}</dt>
                <dd className="m-0 font-mono break-all">{issued.urls[key]}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
      <FormError>{error}</FormError>
      <div>
        <Button type="button" variant="secondary" loading={busy} onClick={rotate}>
          {configured || issued ? 'Issue a new secret' : 'Issue a secret'}
        </Button>
      </div>
    </Card>
  );
}
