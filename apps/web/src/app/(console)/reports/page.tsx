import { EmptyState, ShieldIcon, WarningIcon } from '@kora/ui';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { serverApi } from '@/lib/server-api';
import type { Report, ReportPeriod } from '@/lib/types';
import { ReportView } from './report-view';

export const metadata: Metadata = { title: 'Reports' };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const raw = (await searchParams).period;
  const period: ReportPeriod = raw === 'Q' || raw === 'YTD' ? raw : '12M';
  const res = await serverApi<Report>(`/reports?period=${period}`);
  if (!res.ok) {
    return (
      <>
        <PageHeader title="Reports" />
        {res.status === 403 ? (
          <EmptyState icon={<ShieldIcon />} title="Reports are for managers">
            Portfolio-wide reports are available to managers and administrators.
          </EmptyState>
        ) : (
          <EmptyState icon={<WarningIcon />} title="Couldn’t load reports">
            The server didn’t answer. Reload the page to try again.
          </EmptyState>
        )}
      </>
    );
  }
  return <ReportView report={res.data} />;
}
