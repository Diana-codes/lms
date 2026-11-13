import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { serverApi } from '@/lib/server-api';
import type { Me } from '@/lib/types';
import { TwoFactorCard } from './two-factor-card';

export const metadata: Metadata = { title: 'Security' };

export default async function SecurityPage() {
  const me = await serverApi<Me>('/auth/me');
  if (!me.ok) redirect('/login');

  return (
    <>
      <PageHeader eyebrow={me.data.email} title="Security" />
      <TwoFactorCard enabled={me.data.twoFactorEnabled} />
    </>
  );
}
