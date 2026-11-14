import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { ConsoleNav } from '@/components/console-nav';
import { getCompany, PRODUCT_NAME } from '@/lib/company';
import { serverApi } from '@/lib/server-api';
import type { Me } from '@/lib/types';

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const [me, open, company] = await Promise.all([
    serverApi<Me>('/auth/me'),
    serverApi<{ open: number }>('/applications/open-count'),
    getCompany(),
  ]);
  if (!me.ok) redirect('/login');
  if (me.data.mustChangePassword) redirect('/change-password');
  if (!me.data.twoFactorEnabled) redirect('/two-factor');

  return (
    <div className="flex min-h-screen flex-wrap bg-ground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <ConsoleNav
        me={me.data}
        openApplications={open.ok ? open.data.open : null}
        brand={company?.displayName ?? PRODUCT_NAME}
      />
      <main
        id="main"
        className="box-border flex min-w-0 flex-[999_1_560px] flex-col gap-6 px-5 pt-7 pb-10 md:px-8"
      >
        {children}
      </main>
    </div>
  );
}
