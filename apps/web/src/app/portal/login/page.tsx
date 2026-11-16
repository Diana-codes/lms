import type { Metadata } from 'next';
import { getCompany, PRODUCT_NAME } from '@/lib/company';
import { PortalLoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function PortalLoginPage() {
  const company = await getCompany();
  const name = company?.displayName ?? PRODUCT_NAME;

  if (!company) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="flex max-w-sm flex-col gap-3 text-center">
          <h1 className="m-0 font-display text-2xl font-semibold">This address is not in use</h1>
          <p className="m-0 text-sm text-ink-muted">
            Check the link your lender gave you. Each lender on {PRODUCT_NAME} has its own address.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      <section className="relative overflow-hidden bg-forest px-6 py-10 text-white">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              'radial-gradient(ellipse 80% 60% at 20% 0%, color-mix(in oklab, var(--color-lime) 35%, transparent), transparent 60%)',
          }}
        />
        <div className="relative flex flex-col gap-3">
          <p className="m-0 font-display text-[34px] leading-tight font-semibold tracking-[-0.03em]">
            {name}
          </p>
          <p className="m-0 max-w-sm text-sm text-forest-muted">
            Check your loan, pay with MoMo, or apply — sign in with your phone.
          </p>
        </div>
      </section>
      <section className="flex flex-1 flex-col px-6 py-8">
        <PortalLoginForm lenderName={name} />
      </section>
    </main>
  );
}
