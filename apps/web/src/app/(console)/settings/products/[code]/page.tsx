import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { serverApi } from '@/lib/server-api';
import type { Me, ProductDetail } from '@/lib/types';
import { ProductEditor } from '../product-editor';

export const metadata: Metadata = { title: 'Product' };

export default async function ProductPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const me = await serverApi<Me>('/auth/me');
  if (!me.ok) redirect('/login');
  if (me.data.role !== 'ADMIN' && me.data.role !== 'MANAGER') notFound();
  const res = await serverApi<ProductDetail>(`/products/${encodeURIComponent(code)}`);
  if (!res.ok) notFound();
  const p = res.data;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/settings/products" className="text-ink-muted">
            ← Products
          </Link>
        }
        title={p.name}
      />
      <ProductEditor
        key={`${p.code}:${p.version}:${p.status}`}
        product={p}
        defaults={p.terms}
        canEdit={me.data.role === 'ADMIN'}
      />
    </>
  );
}
