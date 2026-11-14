'use client';

import { Button, Card, CardTitle, FormError, TextField, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { CompanySettings } from '@/lib/types';

const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

/** Where borrowers ask questions and complain; printed on every Key Facts Statement. */
export function ContactForm({ settings }: { settings: CompanySettings }) {
  const router = useRouter();
  const toast = useToast();
  const [phone, setPhone] = useState(settings.supportPhone ?? '');
  const [email, setEmail] = useState(settings.supportEmail ?? '');
  const [address, setAddress] = useState(settings.address ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/company/settings', {
        method: 'PATCH',
        body: {
          supportPhone: orNull(phone),
          supportEmail: orNull(email),
          address: orNull(address),
        },
      });
      toast('Contact details saved.');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const missing = !settings.supportPhone && !settings.supportEmail;
  return (
    <Card>
      <CardTitle>Borrower contact</CardTitle>
      <p className="m-0 text-sm text-ink-muted">
        Printed on every Key Facts Statement as where borrowers ask questions and complain, as BNR
        Regulation 91/2025 requires.
      </p>
      {missing ? (
        <p className="m-0 rounded-control bg-caution-bg px-3.5 py-2.5 text-[13px] text-caution-ink">
          Add at least a phone number or email before giving out Key Facts Statements.
        </p>
      ) : null}
      <form onSubmit={save} className="flex flex-col gap-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Phone"
            type="tel"
            placeholder="e.g. 0788 000 000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <TextField
            label="Email"
            type="email"
            placeholder="e.g. care@lender.rw"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <TextField
          label="Postal or office address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <FormError>{error}</FormError>
        <Button type="submit" className="self-start" loading={busy}>
          Save contact details
        </Button>
      </form>
    </Card>
  );
}
