import { buttonClasses, EmptyState, WarningIcon } from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { type KeyFacts, KeyFactsDocument } from '@/components/key-facts';
import { serverApi } from '@/lib/server-api';
import { PrintButton } from '../../../loans/[code]/statement/print-button';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  return { title: `Key facts ${(await params).code}` };
}

/** The Key Facts Statement to give an applicant before they sign. Prints to PDF. */
export default async function ApplicationKeyFactsPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const res = await serverApi<KeyFacts>(`/applications/${encodeURIComponent(code)}/key-facts`);
  if (!res.ok) {
    return (
      <EmptyState
        icon={<WarningIcon />}
        title="Couldn’t prepare the Key Facts Statement"
        action={
          <Link href="/applications" className={buttonClasses({ variant: 'secondary' })}>
            Back to applications
          </Link>
        }
      />
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link href="/applications" className="mr-auto text-sm font-semibold">
          ← Applications
        </Link>
        <PrintButton />
      </div>
      <KeyFactsDocument kfs={res.data} />
    </>
  );
}
