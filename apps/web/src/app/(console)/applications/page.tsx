import { EmptyState, WarningIcon } from '@kora/ui';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { serverApi } from '@/lib/server-api';
import type { Me, Pipeline, Product } from '@/lib/types';
import { PipelineView } from './pipeline-view';

export const metadata: Metadata = { title: 'Applications' };

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ open?: string; new?: string }>;
}) {
  const params = await searchParams;
  const [pipeline, products, me] = await Promise.all([
    serverApi<Pipeline>('/applications'),
    serverApi<Product[]>('/products'),
    serverApi<Me>('/auth/me'),
  ]);

  if (!pipeline.ok || !products.ok || !me.ok) {
    return (
      <>
        <PageHeader title="Applications" />
        <EmptyState icon={<WarningIcon />} title="Couldn’t load applications">
          The server didn’t answer. Reload the page to try again.
        </EmptyState>
      </>
    );
  }

  return (
    <PipelineView
      columns={pipeline.data.columns}
      products={products.data}
      me={me.data}
      now={Date.now()}
      openCode={typeof params.open === 'string' ? params.open : null}
      startNew={params.new === '1'}
    />
  );
}
