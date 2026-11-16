'use client';

import { formatBps, formatRwf, type MessageKey } from '@kora/core';
import { Button, Money, Pill } from '@kora/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { portalApi } from '@/lib/portal/api';
import { usePortalI18n } from '@/lib/portal/i18n';
import type { PortalSchedule } from '@/lib/portal/types';
import { PortalNav } from '../../portal-nav';

const STATE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'lime' | 'neutral'> = {
  PAID: 'success',
  PARTIAL: 'warning',
  OVERDUE: 'danger',
  DUE_NEXT: 'lime',
  UPCOMING: 'neutral',
};
function ScheduleBody() {
  const params = useSearchParams();
  const { t, date, error: errorText } = usePortalI18n();
  const code = params.get('loan');
  const [data, setData] = useState<PortalSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setError(t('schedule.chooseLoan'));
      return;
    }
    portalApi<PortalSchedule>(`/app/loans/${code}/schedule`)
      .then(setData)
      .catch((e) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <main className="flex flex-1 flex-col gap-4 p-5 pb-8">
      <div className="flex items-center gap-3">
        <Link
          href="/portal/home"
          className="text-2xl text-ink no-underline"
          aria-label={t('common.back')}
        >
          ‹
        </Link>
        <h1 className="m-0 font-display text-xl font-semibold">{t('schedule.title')}</h1>
      </div>

      {error ? <p className="m-0 text-sm text-ink-muted">{error}</p> : null}

      {data ? (
        <section className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="border-b border-line-soft px-4 py-3 text-sm text-ink-muted">
            {t('schedule.rateLine', {
              code: data.code,
              amount: formatRwf(BigInt(data.principal)),
              rate: formatBps(data.annualRateBps, 0),
            })}
          </div>
          <ul className="m-0 list-none p-0">
            {data.rows.map((row) => (
              <li
                key={row.number}
                className="flex items-center gap-3 border-b border-line-soft px-4 py-3 text-sm last:border-b-0"
              >
                <span className="w-6 tabular-nums text-ink-muted">{row.number}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{date(row.dueDate)}</div>
                  {row.state === 'PARTIAL' ||
                  (row.state === 'OVERDUE' && row.remaining !== row.amount) ? (
                    <div className="text-xs text-ink-muted">
                      {t('common.left', { amount: formatRwf(BigInt(row.remaining)) })}
                    </div>
                  ) : null}
                </div>
                <Money amount={row.amount} />
                <Pill tone={STATE_TONE[row.state] ?? 'neutral'}>
                  {t(`state.${row.state}` as MessageKey)}
                </Pill>
              </li>
            ))}
          </ul>
        </section>
      ) : !error ? (
        <p className="m-0 text-sm text-ink-muted">{t('common.loading')}</p>
      ) : (
        <Link href="/portal/home">
          <Button type="button" variant="secondary">
            {t('common.backHome')}
          </Button>
        </Link>
      )}
    </main>
  );
}

function Loading() {
  return (
    <main className="flex flex-1 items-center justify-center p-6 text-sm text-ink-muted">
      {usePortalI18n().t('common.loading')}
    </main>
  );
}

export default function PortalSchedulePage() {
  return (
    <>
      <Suspense fallback={<Loading />}>
        <ScheduleBody />
      </Suspense>
      <PortalNav />
    </>
  );
}
