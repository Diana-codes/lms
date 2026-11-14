'use client';

import { Button, Card, CardTitle, FormError, SelectField, TextField, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { CompanyDetail } from '@/lib/platform';

const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

export function CompanySettingsForm({ company }: { company: CompanyDetail }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    name: company.name,
    legalName: company.legalName ?? '',
    brandName: company.brandName ?? '',
    brandColor: company.brandColor ?? '',
    accentColor: company.accentColor ?? '',
    logoUrl: company.logoUrl ?? '',
    timezone: company.timezone,
    defaultLanguage: company.defaultLanguage,
    aiFeatures: company.aiFeatures,
    autoApprove: company.autoApprove,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string | boolean) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function patch(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/platform/companies/${company.id}`, { method: 'PATCH', body });
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
    void patch(
      {
        name: form.name.trim(),
        legalName: orNull(form.legalName),
        brandName: orNull(form.brandName),
        brandColor: orNull(form.brandColor),
        accentColor: orNull(form.accentColor),
        logoUrl: orNull(form.logoUrl),
        timezone: form.timezone,
        defaultLanguage: form.defaultLanguage,
        aiFeatures: form.aiFeatures,
        autoApprove: form.autoApprove,
      },
      'Settings saved',
    );
  }

  const suspended = company.status === 'SUSPENDED';

  return (
    <Card>
      <CardTitle>Settings</CardTitle>
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        <TextField label="Name" value={form.name} onChange={(e) => set('name')(e.target.value)} />
        <TextField
          label="Registered name"
          value={form.legalName}
          onChange={(e) => set('legalName')(e.target.value)}
        />
        <TextField
          label="Brand name"
          hint="What borrowers and staff see. Leave empty to use the name."
          value={form.brandName}
          onChange={(e) => set('brandName')(e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Brand colour"
            placeholder="#0E3B2E"
            value={form.brandColor}
            onChange={(e) => set('brandColor')(e.target.value)}
          />
          <TextField
            label="Accent colour"
            placeholder="#C6F432"
            value={form.accentColor}
            onChange={(e) => set('accentColor')(e.target.value)}
          />
        </div>
        <TextField
          label="Logo address (https)"
          value={form.logoUrl}
          onChange={(e) => set('logoUrl')(e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Time zone"
            value={form.timezone}
            onChange={(e) => set('timezone')(e.target.value)}
          />
          <SelectField
            label="Default language"
            value={form.defaultLanguage}
            onChange={(e) => set('defaultLanguage')(e.target.value)}
          >
            <option value="EN">English</option>
            <option value="RW">Kinyarwanda</option>
            <option value="FR">French</option>
          </SelectField>
        </div>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-[13px] font-medium text-ink-soft">Optional features</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.aiFeatures}
              onChange={(e) => set('aiFeatures')(e.target.checked)}
            />
            AI assistance
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.autoApprove}
              onChange={(e) => set('autoApprove')(e.target.checked)}
            />
            Bulk-approve low-risk applications
          </label>
        </fieldset>
        <FormError>{error}</FormError>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={busy}>
            Save settings
          </Button>
          <Button
            type="button"
            variant={suspended ? 'secondary' : 'danger'}
            disabled={busy}
            onClick={() => {
              const message = suspended
                ? `Reactivate ${company.name}? Its staff and borrowers can sign in again.`
                : `Suspend ${company.name}? Its staff and borrowers are signed out and cannot sign in until it is reactivated.`;
              if (window.confirm(message)) {
                void patch(
                  { status: suspended ? 'ACTIVE' : 'SUSPENDED' },
                  suspended ? 'Company reactivated' : 'Company suspended',
                );
              }
            }}
          >
            {suspended ? 'Reactivate' : 'Suspend'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
