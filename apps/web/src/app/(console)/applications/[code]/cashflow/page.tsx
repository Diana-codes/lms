import { LENDING_ROLES } from '@kora/core';
import { EmptyState, WarningIcon } from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Breadcrumb } from '@/components/list-tools';
import { PageHeader } from '@/components/page-header';
import { serverApi } from '@/lib/server-api';
import type { Me } from '@/lib/types';
import { CashflowWorkspace } from './cashflow-workspace';
import type { CashflowView } from './types';

export const metadata: Metadata = { title: 'Cash-flow analysis' };

/** PRD §6.15: the credit analyst's view of an applicant's payslips and statements. */
export default async function CashflowPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [me, res] = await Promise.all([
    serverApi<Me>('/auth/me'),
    serverApi<CashflowView>(`/applications/${encodeURIComponent(code)}/cashflow`),
  ]);
  if (!me.ok) redirect('/login');
  if (!res.ok) {
    return (
      <EmptyState icon={<WarningIcon />} title="Couldn’t load the cash-flow analysis">
        {res.status === 403
          ? 'Cash-flow analysis is for loan officers, credit analysts and managers.'
          : 'The server didn’t answer. Reload the page to try again.'}{' '}
        <Link href="/applications">Back to applications</Link>
      </EmptyState>
    );
  }
  const v = res.data;
  return (
    <>
      <Breadcrumb parent="Applications" parentHref="/applications" current={v.application.code} />
      <PageHeader
        eyebrow={`${v.application.code} · ${v.application.productName}`}
        title={`Cash flow: ${v.application.borrowerName}`}
      />
      <CashflowWorkspace
        view={v}
        canEdit={(LENDING_ROLES as readonly string[]).includes(me.data.role)}
      />
    </>
  );
}
