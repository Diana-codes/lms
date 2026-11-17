import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCompany, PRODUCT_NAME } from '@/lib/company';
import { serverApi } from '@/lib/server-api';
import type { Me } from '@/lib/types';
import { StaffTwoFactorSetup } from './setup';

export const metadata: Metadata = { title: 'Turn on two-factor sign-in' };

/** Where the company requires two-factor sign-in, this page comes before the console. */
export default async function TwoFactorPage() {
  const [me, company] = await Promise.all([serverApi<Me>('/auth/me'), getCompany()]);
  if (!me.ok) redirect('/login');
  if (me.data.mustChangePassword) redirect('/change-password');
  if (me.data.twoFactorEnabled) redirect('/');
  // Not required for this company: staff can still turn it on under Settings → Security.
  if (company && !company.features.staffTwoFactor) redirect('/');
  const name = company?.displayName ?? PRODUCT_NAME;

  return (
    <main className="flex min-h-screen items-center justify-center bg-ground p-6">
      <div className="flex w-full max-w-[560px] flex-col gap-5 rounded-panel bg-surface p-8 shadow-sm">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-muted">
            {name} · {me.data.email}
          </span>
          <h1 className="m-0 font-display text-2xl font-semibold">Turn on two-factor sign-in</h1>
          <p className="m-0 text-sm text-ink-muted">
            The console holds borrowers’ personal and financial details, so each sign-in needs a
            code from your phone as well as your password. Set it up once, now.
          </p>
        </div>
        <StaffTwoFactorSetup appIssuer={name} />
      </div>
    </main>
  );
}
