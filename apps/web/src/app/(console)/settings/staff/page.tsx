import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { serverApi } from '@/lib/server-api';
import type { Branch, Me, StaffMember } from '@/lib/types';
import { StaffView } from './staff-view';

export const metadata: Metadata = { title: 'Staff' };

export default async function StaffPage() {
  const me = await serverApi<Me>('/auth/me');
  if (!me.ok) redirect('/login');
  if (me.data.role !== 'ADMIN' && me.data.role !== 'MANAGER') notFound();

  const [staff, branches] = await Promise.all([
    serverApi<StaffMember[]>('/users'),
    serverApi<Branch[]>('/branches'),
  ]);
  if (!staff.ok || !branches.ok) throw new Error('Could not load staff');

  const active = staff.data.filter((s) => s.isActive).length;
  return (
    <>
      <PageHeader
        eyebrow={`${active} active · ${staff.data.length - active} deactivated`}
        title="Staff"
      />
      <StaffView
        staff={staff.data}
        branches={branches.data}
        meId={me.data.id}
        canManage={me.data.role === 'ADMIN'}
      />
    </>
  );
}
