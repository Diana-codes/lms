import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCompany, PRODUCT_NAME } from '@/lib/company';
import { serverApi } from '@/lib/server-api';
import type { Me } from '@/lib/types';
import { ForcedChange } from './forced-change';

export const metadata: Metadata = { title: 'Choose a new password' };

/** After an administrator sets someone's password, they choose their own here first. */
export default async function ChangePasswordPage() {
  const [me, company] = await Promise.all([serverApi<Me>('/auth/me'), getCompany()]);
  if (!me.ok) redirect('/login');
  if (!me.data.mustChangePassword) redirect('/');

  return (
    <main className="flex min-h-screen items-center justify-center bg-ground p-6">
      <div className="flex w-full max-w-md flex-col gap-5 rounded-panel bg-surface p-8 shadow-sm">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-muted">
            {company?.displayName ?? PRODUCT_NAME} · {me.data.email}
          </span>
          <h1 className="m-0 font-display text-2xl font-semibold">Choose a new password</h1>
          <p className="m-0 text-sm text-ink-muted">
            Your administrator set a temporary password for you. Replace it with one only you know
            before you continue.
          </p>
        </div>
        <ForcedChange />
      </div>
    </main>
  );
}
