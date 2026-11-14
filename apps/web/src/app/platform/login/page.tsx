import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PRODUCT_NAME } from '@/lib/company';
import type { PlatformAdmin } from '@/lib/platform';
import { serverApi } from '@/lib/server-api';
import { PlatformLoginForm } from './platform-login-form';

export const metadata: Metadata = { title: 'Platform sign in' };

export default async function PlatformLoginPage() {
  const me = await serverApi<{ admin: PlatformAdmin }>('/platform/auth/me');
  if (me.ok) redirect('/platform');
  return (
    <main className="flex min-h-screen items-center justify-center bg-ground p-6">
      <div className="flex w-full max-w-[400px] flex-col gap-6">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Orin Tech House
          </span>
          <span className="font-display text-xl font-semibold">{PRODUCT_NAME} platform</span>
        </div>
        <PlatformLoginForm apiDown={!me.ok && me.status >= 500} />
        <p className="m-0 text-xs text-ink-muted">
          For platform administrators only. Every sign-in and change is logged.
        </p>
      </div>
    </main>
  );
}
