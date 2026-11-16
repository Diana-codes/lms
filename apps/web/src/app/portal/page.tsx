'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { hasPortalSession } from '@/lib/portal/api';
import { usePortalI18n } from '@/lib/portal/i18n';

/** Send signed-in borrowers home; everyone else to sign-in. */
export default function PortalIndex() {
  const router = useRouter();
  const { t } = usePortalI18n();
  useEffect(() => {
    router.replace(hasPortalSession() ? '/portal/home' : '/portal/login');
  }, [router]);
  return (
    <main className="flex flex-1 items-center justify-center p-6 text-sm text-ink-muted">
      {t('common.opening')}
    </main>
  );
}
