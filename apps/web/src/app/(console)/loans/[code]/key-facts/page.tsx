import { buttonClasses, EmptyState, WarningIcon } from '@kora/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { type KeyFacts, KeyFactsDocument } from '@/components/key-facts';
import { serverApi } from '@/lib/server-api';
import { PrintButton } from '../statement/print-button';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  return { title: `Key facts ${(await params).code}` };
}

/** The Key Facts Statement the loan was issued under. Prints to PDF. */
export default async function LoanKeyFactsPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const res = await serverApi<KeyFacts>(`/loans/${encodeURIComponent(code)}/key-facts`);
  if (!res.ok) {
    return (
      <EmptyState
        icon={<WarningIcon />}
        title="Couldn’t prepare the Key Facts Statement"
        action={
          <Link href={`/loans/${code}`} className={buttonClasses({ variant: 'secondary' })}>
            Back to the loan
          </Link>
        }
      />
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/loans/${code}`} className="mr-auto text-sm font-semibold">
          ← Back to {code}
        </Link>
        <PrintButton />
      </div>
      <KeyFactsDocument kfs={res.data} />
    </>
  );
}
