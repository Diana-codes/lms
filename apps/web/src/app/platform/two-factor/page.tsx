import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PRODUCT_NAME } from '@/lib/company';
import type { PlatformAdmin } from '@/lib/platform';
import { serverApi } from '@/lib/server-api';
import { PlatformTwoFactorSetup } from './setup';

export const metadata: Metadata = { title: 'Turn on two-factor' };

/** Platform admins must turn on two-factor before they can do anything else. */
export default async function PlatformTwoFactorPage() {
  const me = await serverApi<{ admin: PlatformAdmin }>('/platform/auth/me');
  if (!me.ok) redirect('/platform/login');
  if (me.data.admin.twoFactorEnabled) redirect('/platform');
  return (
    <main className="flex min-h-screen items-center justify-center bg-ground p-6">
      <div className="flex w-full max-w-[520px] flex-col gap-6">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
            {PRODUCT_NAME} platform
          </span>
          <h1 className="m-0 font-display text-[26px] font-semibold tracking-[-0.02em]">
            Turn on two-factor sign-in
          </h1>
          <p className="m-0 text-sm text-ink-muted">
            Platform accounts can create and suspend lenders, so they need a code from your phone as
            well as your password: by text message, or from an authenticator app. This is required
            before you continue.
          </p>
        </div>
        <PlatformTwoFactorSetup />
      </div>
    </main>
  );
}
