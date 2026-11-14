import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { NewCompanyForm } from './new-company-form';

export const metadata: Metadata = { title: 'New company' };

export default async function NewCompanyPage() {
  const host = (await headers()).get('host');
  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/platform" className="text-sm text-ink-muted">
          ← Companies
        </Link>
        <h1 className="m-0 font-display text-[28px] font-semibold tracking-[-0.02em]">
          New company
        </h1>
        <p className="m-0 max-w-2xl text-sm text-ink-muted">
          Creates the lender with its own address, chart of accounts and first administrator. The
          lender then sets up its products, staff and rates itself.
        </p>
      </div>
      <NewCompanyForm platformHost={host} />
    </>
  );
}
