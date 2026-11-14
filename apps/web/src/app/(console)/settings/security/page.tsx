import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { getCompany, PRODUCT_NAME } from '@/lib/company';
import { serverApi } from '@/lib/server-api';
import type { Me } from '@/lib/types';
import { PasswordCard } from './password-card';
import { TwoFactorCard } from './two-factor-card';

export const metadata: Metadata = { title: 'Security' };

export default async function SecurityPage() {
  const [me, company] = await Promise.all([serverApi<Me>('/auth/me'), getCompany()]);
  if (!me.ok) redirect('/login');

  return (
    <>
      <PageHeader eyebrow={me.data.email} title="Security" />
      <TwoFactorCard
        method={me.data.twoFactorMethod}
        verifiedPhone={me.data.verifiedPhone}
        appIssuer={company?.displayName ?? PRODUCT_NAME}
      />
      <PasswordCard />
    </>
  );
}
