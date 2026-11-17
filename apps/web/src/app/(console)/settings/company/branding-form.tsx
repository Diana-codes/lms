'use client';

import { Button, Card, CardTitle, FormError, SelectField, TextField, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { CompanySettings } from '@/lib/types';

/** The console's own colours, used when a company sets none. */
const DEFAULT_BRAND = '#0E3B2E';
const DEFAULT_ACCENT = '#C6F432';
const HEX = /^#[0-9a-fA-F]{6}$/;

const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

/** Brand name, colours, logo and default language: what the company's admins may change. */
export function BrandingForm({ settings }: { settings: CompanySettings }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    brandName: settings.brandName ?? '',
    brandColor: settings.brandColor ?? '',
    accentColor: settings.accentColor ?? '',
    logoUrl: settings.logoUrl ?? '',
    defaultLanguage: settings.defaultLanguage,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const colourError = (v: string) => (v && !HEX.test(v) ? 'Use a colour like #0E3B2E' : null);
  const logoError =
    form.logoUrl && !/^(https:\/\/|\/brand\/)/.test(form.logoUrl)
      ? 'Use an https:// address'
      : null;
  const invalid = !!(colourError(form.brandColor) || colourError(form.accentColor) || logoError);

  const brand = HEX.test(form.brandColor) ? form.brandColor : DEFAULT_BRAND;
  const accent = HEX.test(form.accentColor) ? form.accentColor : DEFAULT_ACCENT;
  const name = form.brandName.trim() || settings.name;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (invalid) return;
    setBusy(true);
    setError(null);
    try {
      await api('/company/settings', {
        method: 'PATCH',
        body: {
          brandName: orNull(form.brandName),
          brandColor: orNull(form.brandColor),
          accentColor: orNull(form.accentColor),
          logoUrl: orNull(form.logoUrl),
          defaultLanguage: form.defaultLanguage,
        },
      });
      toast('Branding saved. Reload to see the new colours everywhere.');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>Branding</CardTitle>
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        <TextField
          label="Brand name"
          hint={`What staff and borrowers see, in the console and in text messages. Empty: "${settings.name}".`}
          maxLength={60}
          value={form.brandName}
          onChange={(e) => set('brandName')(e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <ColourField
            label="Brand colour"
            value={form.brandColor}
            fallback={DEFAULT_BRAND}
            error={colourError(form.brandColor)}
            onChange={set('brandColor')}
          />
          <ColourField
            label="Accent colour"
            value={form.accentColor}
            fallback={DEFAULT_ACCENT}
            error={colourError(form.accentColor)}
            onChange={set('accentColor')}
          />
        </div>
        <TextField
          label="Logo address"
          placeholder="https://…/logo.png"
          hint="A square image works best. Leave empty to show your initial."
          value={form.logoUrl}
          error={logoError}
          onChange={(e) => set('logoUrl')(e.target.value)}
        />
        <SelectField
          label="Default language for borrowers"
          value={form.defaultLanguage}
          onChange={(e) => set('defaultLanguage')(e.target.value)}
        >
          <option value="EN">English</option>
          <option value="RW">Kinyarwanda</option>
          <option value="FR">French</option>
        </SelectField>

        <div
          aria-label="Preview"
          className="flex items-center gap-3 rounded-panel p-4"
          style={{ backgroundColor: brand }}
        >
          {form.logoUrl && !logoError ? (
            <img
              src={form.logoUrl}
              alt=""
              className="size-8 rounded-[9px] bg-white object-contain"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-[9px] font-display font-bold"
              style={{ backgroundColor: accent, color: brand }}
            >
              {name.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="font-display font-semibold text-white">{name}</span>
          <span
            className="ml-auto rounded-full px-3 py-1 text-xs font-semibold"
            style={{ backgroundColor: accent, color: brand }}
          >
            Overview
          </span>
        </div>

        <FormError>{error}</FormError>
        <Button type="submit" className="self-start" loading={busy} disabled={invalid}>
          Save branding
        </Button>
      </form>
    </Card>
  );
}

function ColourField({
  label,
  value,
  fallback,
  error,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  error: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-start gap-2">
      <TextField
        className="flex-1"
        label={label}
        placeholder={fallback}
        value={value}
        error={error}
        onChange={(e) => onChange(e.target.value)}
      />
      <input
        type="color"
        aria-label={`Pick ${label.toLowerCase()}`}
        className="mt-[26px] h-11 w-11 shrink-0 cursor-pointer rounded-control border border-line bg-surface p-1"
        value={HEX.test(value) ? value : fallback}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
      />
    </div>
  );
}
