import type { LoanTerms } from '@kora/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { serverApi } from '@/lib/server-api';
import type { Me } from '@/lib/types';
import { ProductEditor } from '../product-editor';

export const metadata: Metadata = { title: 'New product' };

export default async function NewProductPage() {
  const me = await serverApi<Me>('/auth/me');
  if (!me.ok) redirect('/login');
  if (me.data.role !== 'ADMIN') notFound();
  const options = await serverApi<{ defaults: LoanTerms }>('/products/options');
  if (!options.ok) throw new Error('Could not load product options');
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/settings/products" className="text-ink-muted">
            ← Products
          </Link>
        }
        title="New product"
      />
      <p className="m-0 -mt-3 max-w-2xl text-sm text-ink-muted">
        Starts from common Rwandan practice: reducing balance, monthly, a 2% processing fee with 18%
        VAT, and 24% a year on overdue amounts after 3 days. Change anything to suit the product.
      </p>
      <ProductEditor product={null} defaults={options.data.defaults} canEdit />
    </>
  );
}
