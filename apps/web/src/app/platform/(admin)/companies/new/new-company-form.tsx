'use client';

import { Button, Card, CardTitle, FormError, SelectField, TextField } from '@kora/ui';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { type CompanyDetail, companyUrl } from '@/lib/platform';

interface Created {
  company: CompanyDetail;
  firstAdmin: { id: string; email: string };
  webhookToken: string | null;
}

const toSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

export function NewCompanyForm({ platformHost }: { platformHost: string | null }) {
  const [form, setForm] = useState({
    name: '',
    slug: '',
    legalName: '',
    brandName: '',
    timezone: 'Africa/Kigali',
    defaultLanguage: 'EN',
    aiFeatures: false,
    autoApprove: false,
    adminEmail: '',
    adminFirstName: '',
    adminLastName: '',
    adminPassword: '',
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const set = (key: keyof typeof form) => (value: string | boolean) =>
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === 'name' && !slugTouched ? { slug: toSlug(String(value)) } : {}),
    }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<Created>('/platform/companies', {
        method: 'POST',
        body: {
          slug: form.slug,
          name: form.name,
          legalName: form.legalName || undefined,
          brandName: form.brandName || undefined,
          timezone: form.timezone,
          defaultLanguage: form.defaultLanguage,
          aiFeatures: form.aiFeatures,
          autoApprove: form.autoApprove,
          admin: {
            email: form.adminEmail,
            firstName: form.adminFirstName,
            lastName: form.adminLastName,
            password: form.adminPassword,
          },
        },
      });
      setCreated(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    const url = companyUrl(created.company.slug, platformHost);
    return (
      <Card className="max-w-2xl">
        <CardTitle>{created.company.name} is ready</CardTitle>
        <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-ink-muted">Console</dt>
          <dd className="m-0">
            <a href={url}>{url}</a>
          </dd>
          <dt className="text-ink-muted">First administrator</dt>
          <dd className="m-0">{created.firstAdmin.email}</dd>
        </dl>
        {created.webhookToken ? (
          <div className="flex flex-col gap-2 rounded-panel bg-caution-bg p-4 text-caution-ink">
            <strong className="text-sm">Webhook secret: shown once</strong>
            <code className="text-sm break-all">{created.webhookToken}</code>
            <span className="text-xs">
              It goes in this company&apos;s MoMo and SMS callback URLs. It is stored encrypted and
              is not shown again; you can issue a new one from the company page.
            </span>
          </div>
        ) : null}
        <p className="m-0 text-sm text-ink-muted">
          Give the administrator their password over a separate channel. Next: add the
          company&apos;s MoMo and SMS keys on its page.
        </p>
        <div className="flex gap-3">
          <Link href={`/platform/companies/${created.company.id}`} className="font-semibold">
            Open company page
          </Link>
          <Link href="/platform">Back to companies</Link>
        </div>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className="flex max-w-3xl flex-col gap-6" noValidate>
      <Card>
        <CardTitle>Company</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Name"
            required
            value={form.name}
            onChange={(e) => set('name')(e.target.value)}
          />
          <TextField
            label="Address"
            hint={form.slug ? `${form.slug}.<domain>` : 'Lowercase letters, digits, hyphens'}
            required
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true);
              set('slug')(e.target.value.toLowerCase());
            }}
          />
          <TextField
            label="Registered name (optional)"
            value={form.legalName}
            onChange={(e) => set('legalName')(e.target.value)}
          />
          <TextField
            label="Brand name (optional)"
            hint="What borrowers see, if different"
            value={form.brandName}
            onChange={(e) => set('brandName')(e.target.value)}
          />
          <SelectField
            label="Time zone"
            value={form.timezone}
            onChange={(e) => set('timezone')(e.target.value)}
          >
            <option value="Africa/Kigali">Africa/Kigali (Rwanda)</option>
            <option value="Africa/Kampala">Africa/Kampala (Uganda)</option>
            <option value="Africa/Nairobi">Africa/Nairobi (Kenya)</option>
            <option value="Africa/Dar_es_Salaam">Africa/Dar es Salaam (Tanzania)</option>
            <option value="Africa/Bujumbura">Africa/Bujumbura (Burundi)</option>
          </SelectField>
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
          <legend className="mb-1 text-[13px] font-medium text-ink-soft">
            Optional features (off unless switched on)
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.aiFeatures}
              onChange={(e) => set('aiFeatures')(e.target.checked)}
            />
            AI assistance: summaries, collections advice, &ldquo;Ask your data&rdquo;
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.autoApprove}
              onChange={(e) => set('autoApprove')(e.target.checked)}
            />
            Bulk-approve applications that meet a product&apos;s auto-approve policy
          </label>
        </fieldset>
      </Card>

      <Card>
        <CardTitle>First administrator</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First name"
            required
            value={form.adminFirstName}
            onChange={(e) => set('adminFirstName')(e.target.value)}
          />
          <TextField
            label="Last name"
            required
            value={form.adminLastName}
            onChange={(e) => set('adminLastName')(e.target.value)}
          />
          <TextField
            label="Email"
            type="email"
            required
            value={form.adminEmail}
            onChange={(e) => set('adminEmail')(e.target.value)}
          />
          <TextField
            label="Initial password"
            type="password"
            autoComplete="new-password"
            hint="At least 12 characters"
            required
            value={form.adminPassword}
            onChange={(e) => set('adminPassword')(e.target.value)}
          />
        </div>
      </Card>

      <FormError>{error}</FormError>
      <div>
        <Button
          type="submit"
          loading={busy}
          disabled={
            !form.name ||
            !form.slug ||
            !form.adminEmail ||
            !form.adminFirstName ||
            !form.adminLastName ||
            form.adminPassword.length < 12
          }
        >
          {busy ? 'Creating…' : 'Create company'}
        </Button>
      </div>
    </form>
  );
}
