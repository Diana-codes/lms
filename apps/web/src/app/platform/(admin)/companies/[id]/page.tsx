import { Card, CardTitle, Pill, Table, Td, Th } from '@kora/ui';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { type CompanyDetail, companyUrl } from '@/lib/platform';
import { serverApi } from '@/lib/server-api';
import { ProviderKeysForm } from '@/components/company/provider-keys-form';
import { WebhookSecret } from '@/components/company/webhook-secret';
import { CompanySettingsForm } from './company-settings-form';

export const metadata: Metadata = { title: 'Company' };

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [res, host] = await Promise.all([
    serverApi<CompanyDetail>(`/platform/companies/${encodeURIComponent(id)}`),
    headers().then((h) => h.get('host')),
  ]);
  if (!res.ok) notFound();
  const c = res.data;
  const url = companyUrl(c.slug, host);

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/platform" className="text-sm text-ink-muted">
          ← Companies
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 font-display text-[28px] font-semibold tracking-[-0.02em]">
            {c.brandName ?? c.name}
          </h1>
          <Pill tone={c.status === 'ACTIVE' ? 'success' : 'danger'}>
            {c.status === 'ACTIVE' ? 'Active' : 'Suspended'}
          </Pill>
        </div>
        <p className="m-0 text-sm text-ink-muted">
          <a href={url}>{url}</a> · {c.timezone} · {c.currency}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <CompanySettingsForm company={c} />
        <div className="flex flex-col gap-6">
          <ProviderKeysForm
            endpoint={`/platform/companies/${c.id}`}
            configured={c.secrets}
            intro="Each lender uses its own MTN MoMo and Africa's Talking accounts. Without them the simulators are used in development; in production MoMo and SMS stay off for this company."
          />
          <WebhookSecret
            endpoint={`/platform/companies/${c.id}`}
            configured={c.webhookConfigured}
          />
          <Card>
            <CardTitle>Administrators</CardTitle>
            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
              {c.admins.map((a) => (
                <li key={a.id} className="flex justify-between gap-3">
                  <span>
                    {a.firstName} {a.lastName}
                  </span>
                  <span className="text-ink-muted">
                    {a.email}
                    {a.isActive ? '' : ' (inactive)'}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Card>
        <CardTitle>Usage, last 31 days</CardTitle>
        {c.usage.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">
            Recorded by the nightly run at 01:00 in the company&apos;s time zone. Nothing yet.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Day</Th>
                <Th numeric>Active loans</Th>
                <Th numeric>Borrowers</Th>
                <Th numeric>Active staff</Th>
                <Th numeric>Loans disbursed</Th>
                <Th numeric>SMS sent</Th>
              </tr>
            </thead>
            <tbody>
              {c.usage.map((u) => (
                <tr key={u.day}>
                  <Td>{u.day.slice(0, 10)}</Td>
                  <Td numeric>{u.activeLoans.toLocaleString('en-US')}</Td>
                  <Td numeric>{u.borrowers.toLocaleString('en-US')}</Td>
                  <Td numeric>{u.activeStaff}</Td>
                  <Td numeric>{u.loansDisbursed}</Td>
                  <Td numeric>{u.smsSent}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
