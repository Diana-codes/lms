import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCompany, PRODUCT_NAME } from '@/lib/company';
import { serverApi } from '@/lib/server-api';
import type { Me } from '@/lib/types';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

/** Only allow redirects back into this app, never to another site. */
function safeNext(value: string | string[] | undefined): string {
  const next = Array.isArray(value) ? value[0] : value;
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\')
    ? next
    : '/';
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const next = safeNext((await searchParams).next);
  const [me, company] = await Promise.all([serverApi<Me>('/auth/me'), getCompany()]);
  if (me.ok) redirect(next);
  if (!company && me.status === 404) return <UnknownCompany />;
  const name = company?.displayName ?? PRODUCT_NAME;

  return (
    <main className="flex min-h-screen flex-wrap">
      <section className="flex flex-[1_1_360px] flex-col justify-between gap-10 bg-forest p-8 text-white md:p-12">
        <div className="flex items-center gap-2.5">
          {company?.logoUrl ? (
            <img src={company.logoUrl} alt="" className="size-8 rounded-[9px] object-contain" />
          ) : (
            <div
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-[9px] bg-lime font-display font-bold text-forest"
            >
              {name.charAt(0)}
            </div>
          )}
          <span className="font-display text-lg font-semibold">{name}</span>
        </div>
        <div className="flex max-w-md flex-col gap-4">
          <p className="m-0 font-display text-[32px] leading-tight font-semibold tracking-[-0.02em]">
            Lending, collections and reporting in one console.
          </p>
          <p className="m-0 text-sm text-forest-muted">
            For loan officers, collections agents and managers.
          </p>
        </div>
        <p className="m-0 text-xs text-forest-muted">
          Staff access only. Sign-ins are logged.
          {company ? ` Runs on ${PRODUCT_NAME}.` : null}
        </p>
      </section>
      <section className="flex flex-[2_1_420px] items-center justify-center p-6 md:p-12">
        <LoginForm next={next} apiDown={!me.ok && me.status >= 500} />
      </section>
    </main>
  );
}

/** The address names no company on the platform. */
function UnknownCompany() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ground p-6">
      <div className="flex max-w-md flex-col gap-3 text-center">
        <h1 className="m-0 font-display text-2xl font-semibold">This address is not in use</h1>
        <p className="m-0 text-sm text-ink-muted">
          Check the link your lender gave you. Each lender on {PRODUCT_NAME} has its own address.
        </p>
      </div>
    </main>
  );
}
