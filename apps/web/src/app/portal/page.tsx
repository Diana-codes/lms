'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { hasPortalSession } from '@/lib/portal/api';

/** Send signed-in borrowers home; everyone else to sign-in. */
export default function PortalIndex() {
  const router = useRouter();
  useEffect(() => {
    router.replace(hasPortalSession() ? '/portal/home' : '/portal/login');
  }, [router]);
  return (
    <main className="flex flex-1 items-center justify-center p-6 text-sm text-ink-muted">
      Opening…
    </main>
  );
}
