import { Card, CardTitle, Pill } from '@kora/ui';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ProviderKeysForm } from '@/components/company/provider-keys-form';
import { WebhookSecret } from '@/components/company/webhook-secret';
import { PageHeader } from '@/components/page-header';
import { PRODUCT_NAME } from '@/lib/company';
import { serverApi } from '@/lib/server-api';
import type { CompanySettings, Me } from '@/lib/types';
import { BrandingForm } from './branding-form';

export const metadata: Metadata = { title: 'Company settings' };
export default async function CompanySettingsPage() {
  const me = await serverApi<Me>('/auth/me');
  if (!me.ok) redirect('/login');
  if (me.data.role !== 'ADMIN') notFound();
  const res = await serverApi<CompanySettings>('/company/settings');
  if (!res.ok) throw new Error('Could not load company settings');
  const s = res.data;

  return (
    <>
      <PageHeader eyebrow={`${s.slug} · ${s.currency} · ${s.timezone}`} title="Company settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <BrandingForm settings={s} />
          <Card>
            <CardTitle>Set by {PRODUCT_NAME}</CardTitle>
            <p className="m-0 text-sm text-ink-muted">
              To change these, contact {PRODUCT_NAME} support.
            </p>
            <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-ink-muted">Name</dt>
              <dd className="m-0">{s.name}</dd>
              <dt className="text-ink-muted">Registered name</dt>
              <dd className="m-0">{s.legalName ?? '—'}</dd>
              <dt className="text-ink-muted">Country and currency</dt>
              <dd className="m-0">
                {s.country} · {s.currency}
              </dd>
              <dt className="text-ink-muted">Time zone</dt>
              <dd className="m-0">{s.timezone}</dd>
              <dt className="text-ink-muted">AI assistance</dt>
              <dd className="m-0">
                <Pill tone={s.features.ai ? 'success' : 'neutral'}>
                  {s.features.ai ? 'On' : 'Off'}
                </Pill>
              </dd>
              <dt className="text-ink-muted">Bulk-approve low-risk</dt>
              <dd className="m-0">
                <Pill tone={s.features.autoApprove ? 'success' : 'neutral'}>
                  {s.features.autoApprove ? 'On' : 'Off'}
                </Pill>
              </dd>
            </dl>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <ProviderKeysForm
            endpoint="/company/settings"
            configured={s.secrets}
            intro="Your own MTN MoMo and Africa's Talking accounts: disbursements, repayments and messages to borrowers go through them. Values are stored encrypted and never shown again. Staff sign-in codes are sent by the platform, not this account."
          />
          <WebhookSecret endpoint="/company/settings" configured={s.webhookConfigured} />
        </div>
      </div>
    </>
  );
}
