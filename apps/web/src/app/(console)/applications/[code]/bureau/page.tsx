import { LENDING_ROLES } from '@kora/core';
import { EmptyState, WarningIcon } from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Breadcrumb } from '@/components/list-tools';
import { PageHeader } from '@/components/page-header';
import { serverApi } from '@/lib/server-api';
import type { Me } from '@/lib/types';
import { BureauChecks, type BureauChecksView } from './bureau-checks';

export const metadata: Metadata = { title: 'Credit bureau checks' };

/** Appendix A.11: check the bureau for every applicant and guarantor, with consent. */
export default async function ApplicationBureauPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const [me, res] = await Promise.all([
    serverApi<Me>('/auth/me'),
    serverApi<BureauChecksView>(`/applications/${encodeURIComponent(code)}/bureau`),
  ]);
  if (!me.ok) redirect('/login');
  if (!res.ok) {
    return (
      <EmptyState icon={<WarningIcon />} title="Couldn’t load the credit bureau checks">
        {res.status === 404 ? 'There is no such application.' : 'Reload the page to try again.'}{' '}
        <Link href="/applications">Back to applications</Link>
      </EmptyState>
    );
  }
  return (
    <>
      <Breadcrumb parent="Applications" parentHref="/applications" current={res.data.application} />
      <PageHeader
        eyebrow={`${res.data.application} · ${res.data.borrower.phone}`}
        title={`Credit bureau: ${res.data.borrower.name}`}
      />
      <BureauChecks
        code={code}
        initial={res.data}
        canEdit={(LENDING_ROLES as readonly string[]).includes(me.data.role)}
      />
    </>
  );
}
