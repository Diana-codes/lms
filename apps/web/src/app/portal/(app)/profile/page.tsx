'use client';

import { formatDate } from '@kora/core';
import { Button, Money } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  clearPortalTokens,
  portalApi,
  portalErrorMessage,
} from '@/lib/portal/api';
import type { PortalProfile } from '@/lib/portal/types';
import { PortalNav } from '../../portal-nav';

export default function PortalProfilePage() {
  const router = useRouter();
  const [data, setData] = useState<PortalProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    portalApi<PortalProfile>('/app/profile')
      .then(setData)
      .catch((e) => setError(portalErrorMessage(e)));
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
        <h1 className="m-0 font-display text-xl font-semibold">Profile</h1>
        {error ? <p className="m-0 text-sm text-ink-muted">{error}</p> : null}
        {data ? (
          <>
            <section className="rounded-2xl border border-line bg-surface p-4">
              <p className="m-0 font-display text-lg font-semibold">{data.name}</p>
              <p className="m-0 text-sm text-ink-muted">
                {data.code} · {data.phone}
                {data.nationalId ? ` · ID ${data.nationalId}` : ''}
              </p>
              {data.business ? (
                <p className="m-0 mt-2 text-sm">
                  {data.business.name}
                  {data.business.sector ? ` · ${data.business.sector}` : ''}
                </p>
              ) : null}
              <p className="m-0 mt-1 text-xs text-ink-muted">KYC: {data.kycStatus}</p>
            </section>

            <section className="flex flex-col gap-2">
              <h2 className="m-0 text-sm font-semibold">Loans</h2>
              {data.loans.length === 0 ? (
                <p className="m-0 text-sm text-ink-muted">No loans yet.</p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {data.loans.map((l) => (
                    <li
                      key={l.code}
                      className="rounded-xl border border-line-soft px-3 py-2 text-sm"
                    >
                      <div className="font-semibold">{l.code}</div>
                      <div className="text-ink-muted">
                        {l.productName} · <Money amount={l.principal} /> · {l.status}
                        {l.disbursedOn ? ` · ${formatDate(l.disbursedOn)}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.consents.some((c) => c.type === 'MOMO_HISTORY') ? (
              <section className="rounded-xl border border-line bg-surface p-4 text-sm">
                <p className="m-0 font-semibold">MoMo history sharing</p>
                <p className="m-0 mt-1 text-ink-muted">
                  You shared wallet history to help with credit decisions.
                </p>
                <button
                  type="button"
                  className="mt-2 text-sm font-semibold text-forest underline-offset-2 hover:underline"
                  onClick={withdrawMomo}
                >
                  Withdraw this consent
                </button>
              </section>
            ) : null}

            <Button type="button" variant="secondary" disabled={busy} onClick={signOut}>
              {busy ? 'Signing out…' : 'Sign out'}
            </Button>
          </>
        ) : !error ? (
          <p className="m-0 text-sm text-ink-muted">Loading…</p>
        ) : null}
      </main>
      <PortalNav />
    </>
  );
}
