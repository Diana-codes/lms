'use client';

import { type MessageKey } from '@kora/core';
import { Button, Money } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { clearPortalTokens, portalApi } from '@/lib/portal/api';
import { LanguageSwitch, usePortalI18n } from '@/lib/portal/i18n';
import type { PortalProfile } from '@/lib/portal/types';
import { PortalNav } from '../../portal-nav';

export default function PortalProfilePage() {
  const router = useRouter();
  const { t, date, option, error: errorText, adopt } = usePortalI18n();
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<PortalProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    portalApi<PortalProfile>('/app/profile')
      .then((p) => {
        adopt(p.language);
        setData(p);
      })
      .catch((e) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signOut() {
    setBusy(true);
    try {
      await portalApi('/app/auth/logout', { method: 'POST' });
    } catch {
      // already gone
    }
    clearPortalTokens();
    router.replace('/portal/login');
  }

  async function withdrawMomo() {
    await portalApi('/app/profile/consents/withdraw', {
      method: 'POST',
      body: { type: 'MOMO_HISTORY' },
    });
    setData(await portalApi<PortalProfile>('/app/profile'));
  }

  return (
    <>
      <main className="flex flex-1 flex-col gap-5 p-5 pb-8">
        <h1 className="m-0 font-display text-xl font-semibold">{t('profile.title')}</h1>
        {error ? <p className="m-0 text-sm text-ink-muted">{error}</p> : null}
        {data ? (
          <>
            <section className="rounded-2xl border border-line bg-surface p-4">
              <p className="m-0 font-display text-lg font-semibold">{data.name}</p>
              <p className="m-0 text-sm text-ink-muted">
                {data.code} · {data.phone}
                {data.nationalId ? ` · ${t('profile.nationalId')} ${data.nationalId}` : ''}
              </p>
              {data.business ? (
                <p className="m-0 mt-2 text-sm">
                  {data.business.name}
                  {data.business.sector ? ` · ${option(data.business.sector)}` : ''}
                </p>
              ) : null}
              <p className="m-0 mt-1 text-xs text-ink-muted">
                {t('profile.identity')}: {t(`profile.kyc.${data.kycStatus}` as MessageKey)}
              </p>
            </section>

            <section className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
              <h2 className="m-0 text-sm font-semibold">{t('common.language')}</h2>
              <LanguageSwitch onSaved={setNotice} />
              <p className="m-0 text-xs text-ink-muted" role="status">
                {notice ?? t('common.languageHint')}
              </p>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="m-0 text-sm font-semibold">{t('profile.loans')}</h2>
              {data.loans.length === 0 ? (
                <p className="m-0 text-sm text-ink-muted">{t('profile.noLoans')}</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {data.loans.map((l) => (
                    <li
                      key={l.code}
                      className="rounded-xl border border-line-soft px-3 py-2 text-sm"
                    >
                      <div className="font-semibold">{l.code}</div>
                      <div className="text-ink-muted">
                        {l.productName} · <Money amount={l.principal} /> ·{' '}
                        {t(`loanStatus.${l.status}` as MessageKey)}
                        {l.disbursedOn ? ` · ${date(l.disbursedOn)}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.consents.some((c) => c.type === 'MOMO_HISTORY') ? (
              <section className="rounded-xl border border-line bg-surface p-4 text-sm">
                <p className="m-0 font-semibold">{t('profile.momoSharing')}</p>
                <p className="m-0 mt-1 text-ink-muted">{t('profile.momoShared')}</p>
                <button
                  type="button"
                  className="mt-2 text-sm font-semibold text-forest underline-offset-2 hover:underline"
                  onClick={withdrawMomo}
                >
                  {t('profile.stopMomo')}
                </button>
              </section>
            ) : null}

            <Button type="button" variant="secondary" disabled={busy} onClick={signOut}>
              {busy ? t('profile.signingOut') : t('profile.signOut')}
            </Button>
          </>
        ) : !error ? (
          <p className="m-0 text-sm text-ink-muted">{t('common.loading')}</p>
        ) : null}
      </main>
      <PortalNav />
    </>
  );
}
