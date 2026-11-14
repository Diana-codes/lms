import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { PRODUCT_NAME } from '@/lib/company';
import type { PlatformAdmin } from '@/lib/platform';
import { serverApi } from '@/lib/server-api';
import { PlatformSignOut } from './sign-out';

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const me = await serverApi<{ admin: PlatformAdmin }>('/platform/auth/me');
  if (!me.ok) redirect('/platform/login');

  return (
    <div className="flex min-h-screen flex-col bg-ground">
      <header className="flex flex-wrap items-center justify-between gap-4 bg-forest px-5 py-3 text-white md:px-8">
        <Link href="/platform" className="flex flex-col text-white no-underline">
          <span className="text-[11px] font-semibold tracking-wide text-forest-muted uppercase">
            Orin Tech House
          </span>
          <span className="font-display text-lg font-semibold">{PRODUCT_NAME} platform</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-forest-fg">{me.data.admin.name}</span>
          <PlatformSignOut />
        </div>
      </header>
      <main className="mx-auto box-border flex w-full max-w-6xl flex-col gap-6 px-5 pt-7 pb-10 md:px-8">
        {children}
      </main>
    </div>
  );
}
