import { EmptyState, WarningIcon } from '@kora/ui';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { serverApi } from '@/lib/server-api';
import type { CollectionsQueue, Me } from '@/lib/types';
import { CollectionsView } from './collections-view';

export const metadata: Metadata = { title: 'Collections' };

export default async function CollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string; bucket?: string }>;
}) {
  const params = await searchParams;
  const [queue, me] = await Promise.all([
    serverApi<CollectionsQueue>('/collections'),
    serverApi<Me>('/auth/me'),
  ]);
  if (!queue.ok || !me.ok) {
    return (
      <>
        <PageHeader title="Collections" />
        <EmptyState icon={<WarningIcon />} title="Couldn’t load the collections queue">
          The server didn’t answer. Reload the page to try again.
        </EmptyState>
      </>
    );
  }
  const bucket = ['DPD_1_30', 'DPD_31_90', 'DPD_90_PLUS'].includes(params.bucket ?? '')
    ? (params.bucket as 'DPD_1_30')
    : 'ALL';
  return (
    <CollectionsView
      queue={queue.data}
      me={me.data}
      initialOpen={params.open ?? null}
      initialBucket={bucket}
    />
  );
}
