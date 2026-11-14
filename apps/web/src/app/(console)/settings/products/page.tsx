import { describeRate, FREQUENCY_LABELS, formatRwfCompact, PRODUCT_KIND_LABELS } from '@kora/core';
import { buttonClasses, Card, Pill, PlusIcon, Table, Td, Th } from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { serverApi } from '@/lib/server-api';
import type { Me, ProductSummary } from '@/lib/types';
import { STATUS_PILL } from './status';

export const metadata: Metadata = { title: 'Products' };

export default async function ProductsPage() {
  const me = await serverApi<Me>('/auth/me');
  if (!me.ok) redirect('/login');
  if (me.data.role !== 'ADMIN' && me.data.role !== 'MANAGER') notFound();
  const res = await serverApi<ProductSummary[]>('/products/manage');
  if (!res.ok) throw new Error('Could not load products');
  const published = res.data.filter((p) => p.status === 'PUBLISHED').length;

  return (
    <>
      <PageHeader eyebrow={`${published} published · ${res.data.length} in all`} title="Products">
        {me.data.role === 'ADMIN' ? (
          <Link href="/settings/products/new" className={buttonClasses()}>
            <PlusIcon /> New product
          </Link>
        ) : null}
      </PageHeader>
      <Card>
        {res.data.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">
            No products yet.{' '}
            {me.data.role === 'ADMIN'
              ? 'Create one to start taking applications; it begins from common Rwandan terms.'
              : 'An administrator creates them.'}
          </p>
        ) : null}
        <Table minWidth={820} hidden={res.data.length === 0}>
          <thead>
            <tr>
              <Th>Product</Th>
              <Th>Pricing</Th>
              <Th>Repayment</Th>
              <Th>Amounts</Th>
              <Th>Status</Th>
              <Th numeric>Active loans</Th>
            </tr>
          </thead>
          <tbody>
            {res.data.map((p) => (
              <tr key={p.code}>
                <Td>
                  <Link
                    href={`/settings/products/${p.code}`}
                    className="flex flex-col no-underline"
                  >
                    <span className="font-semibold text-ink">{p.name}</span>
                    <span className="text-[13px] text-ink-muted">
                      {p.code} · {PRODUCT_KIND_LABELS[p.kind]} · version {p.version}
                    </span>
                  </Link>
                </Td>
                <Td>{describeRate(p.terms)}</Td>
                <Td>
                  {FREQUENCY_LABELS[p.terms.frequency]} · {p.minTermMonths}–{p.maxTermMonths} months
                </Td>
                <Td>
                  {formatRwfCompact(BigInt(p.minAmount))} – {formatRwfCompact(BigInt(p.maxAmount))}
                </Td>
                <Td>
                  <Pill tone={STATUS_PILL[p.status].tone}>{STATUS_PILL[p.status].label}</Pill>
                </Td>
                <Td numeric>{p.activeLoans}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
