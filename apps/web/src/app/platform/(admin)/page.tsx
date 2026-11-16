import { buttonClasses, Card, Pill, Table, Td, Th } from '@kora/ui';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { type CompanyRow, companyUrl } from '@/lib/platform';
import { serverApi } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Companies' };

export default async function CompaniesPage() {
  const [res, host] = await Promise.all([
    serverApi<CompanyRow[]>('/platform/companies'),
    headers().then((h) => h.get('host')),
  ]);
  const companies = res.ok ? res.data : [];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[28px] font-semibold tracking-[-0.02em]">
            Companies
          </h1>
          <p className="m-0 text-sm text-ink-muted">
            Lenders on the platform. Each has its own address, data, staff and provider accounts.
          </p>
        </div>
        <Link href="/platform/companies/new" className={buttonClasses()}>
          New company
        </Link>
      </div>

      <Card>
        {!res.ok ? (
          <p className="m-0 text-sm text-danger-fg">Could not load companies.</p>
        ) : companies.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">No companies yet.</p>
        ) : (
          <Table minWidth={760}>
            <thead>
              <tr>
                <Th>Company</Th>
                <Th>Address</Th>
                <Th>Status</Th>
                <Th numeric>Staff</Th>
                <Th numeric>Borrowers</Th>
                <Th numeric>Active loans</Th>
                <Th>Optional features</Th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link
                      href={`/platform/companies/${c.id}`}
                      className="font-semibold text-ink no-underline hover:underline"
                    >
                      {c.brandName ?? c.name}
                    </Link>
                    {c.brandName ? <div className="text-xs text-ink-muted">{c.name}</div> : null}
                  </Td>
                  <Td>
                    <a href={companyUrl(c.slug, host)} className="text-sm">
                      {c.slug}
                    </a>
                  </Td>
                  <Td>
                    <Pill tone={c.status === 'ACTIVE' ? 'success' : 'danger'}>
                      {c.status === 'ACTIVE' ? 'Active' : 'Suspended'}
                    </Pill>
                  </Td>
                  <Td numeric>{c.activeStaff}</Td>
                  <Td numeric>{c.borrowers.toLocaleString('en-US')}</Td>
                  <Td numeric>
                    {c.latestUsage ? c.latestUsage.activeLoans.toLocaleString('en-US') : '–'}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {c.aiFeatures ? <Pill tone="ai">AI</Pill> : null}
                      {c.autoApprove ? <Pill tone="info">Bulk approve</Pill> : null}
                      {c.staffTwoFactor ? <Pill tone="warning">Staff 2FA</Pill> : null}
                      {c.borrowerOtp ? <Pill tone="warning">Borrower OTP</Pill> : null}
                      {!c.aiFeatures &&
                      !c.autoApprove &&
                      !c.staffTwoFactor &&
                      !c.borrowerOtp ? (
                        <span className="text-xs text-ink-muted">None</span>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="m-0 text-xs text-ink-muted">Active loans come from the last nightly run.</p>
    </>
  );
}
