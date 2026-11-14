'use client';

import { Button, Card, CardTitle, FormError, Pill, TextField, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';

/** Field name in the API → the stored setting it writes, and how it is shown here. */
const FIELDS = [
  {
    name: 'momoCollectionKey',
    key: 'momo.collection_key',
    label: 'MoMo collections key',
    secret: true,
  },
  {
    name: 'momoDisbursementKey',
    key: 'momo.disbursement_key',
    label: 'MoMo disbursements key',
    secret: true,
  },
  { name: 'momoPayCode', key: 'momo.pay_code', label: 'MoMo Pay merchant code', secret: false },
  { name: 'smsUsername', key: 'sms.username', label: "Africa's Talking username", secret: false },
  { name: 'smsApiKey', key: 'sms.api_key', label: "Africa's Talking API key", secret: true },
  { name: 'smsSenderId', key: 'sms.sender_id', label: 'SMS sender name', secret: false },
] as const;

type FieldName = (typeof FIELDS)[number]['name'];

/**
 * The company's own MoMo and SMS accounts. Values are write-only: the API
 * never sends them back, so the form only says whether each is set. Empty
 * fields are left as they are.
 */
export function ProviderKeysForm({
  companyId,
  configured,
}: {
  companyId: string;
  configured: Record<string, boolean>;
}) {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<Partial<Record<FieldName, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Partial<Record<FieldName, string | null>>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/platform/companies/${companyId}/secrets`, { method: 'PUT', body });
      setValues({});
      toast(done);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v && v.trim() !== ''),
    ) as Partial<Record<FieldName, string>>;
    if (Object.keys(body).length === 0) return;
    void send(body, 'Provider settings saved');
  }

  const momoReady = configured['momo.collection_key'] && configured['momo.disbursement_key'];
  const smsReady = configured['sms.api_key'];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Provider accounts</CardTitle>
        <div className="flex gap-1.5">
          <Pill tone={momoReady ? 'success' : 'warning'}>
            MoMo: {momoReady ? 'own account' : 'simulator'}
          </Pill>
          <Pill tone={smsReady ? 'success' : 'warning'}>
            SMS: {smsReady ? 'own account' : 'simulator'}
          </Pill>
        </div>
      </div>
      <p className="m-0 text-sm text-ink-muted">
        Each lender uses its own MTN MoMo and Africa&apos;s Talking accounts. Without them the
        simulators are used in development; in production MoMo and SMS stay off for this company.
      </p>
      <form onSubmit={save} className="flex flex-col gap-3" noValidate>
        {FIELDS.map((f) => (
          <div key={f.name} className="flex items-end gap-2">
            <TextField
              className="flex-1"
              label={f.label}
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              placeholder={configured[f.key] ? 'Set (leave empty to keep)' : 'Not set'}
              value={values[f.name] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
            {configured[f.key] ? (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove the ${f.label.toLowerCase()}?`)) {
                    void send({ [f.name]: null }, `${f.label} removed`);
                  }
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>
        ))}
        <FormError>{error}</FormError>
        <div>
          <Button
            type="submit"
            loading={busy}
            disabled={!Object.values(values).some((v) => v && v.trim() !== '')}
          >
            Save provider settings
          </Button>
        </div>
      </form>
    </Card>
  );
}
