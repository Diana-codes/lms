'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { hasPortalSession } from '@/lib/portal/api';
import { rememberApplyProduct } from '@/lib/portal/apply-intent';
import { usePortalI18n } from '@/lib/portal/i18n';

/**
 * Send signed-in borrowers home, or straight to the application form when
 * they came from a product on the website; everyone else to sign-in.
 */
export default function PortalIndex() {
  const router = useRouter();
  const { t } = usePortalI18n();
  useEffect(() => {
    const product = new URLSearchParams(window.location.search).get('product');
    if (product) rememberApplyProduct(product);
    const signedIn = hasPortalSession();
    router.replace(signedIn ? (product ? '/portal/apply' : '/portal/home') : '/portal/login');
  }, [router]);
  return (
    <main className="flex flex-1 items-center justify-center p-6 text-sm text-ink-muted">
      {t('common.opening')}
    </main>
  );
}
