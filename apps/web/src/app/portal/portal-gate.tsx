'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { hasPortalSession } from '@/lib/portal/api';
import { usePortalI18n } from '@/lib/portal/i18n';

/** Client gate: signed-out visitors go to /portal/login. */
export function PortalGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { t } = usePortalI18n();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!hasPortalSession()) {
      router.replace('/portal/login');
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center p-6 text-sm text-ink-muted">
        {t('common.checkingSession')}
      </main>
    );
  }
  return <>{children}</>;
}
