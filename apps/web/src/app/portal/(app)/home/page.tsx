'use client';

import { formatDate } from '@kora/core';
import { Button, Money, Pill } from '@kora/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { portalApi, portalErrorMessage } from '@/lib/portal/api';
import type { PortalHome } from '@/lib/portal/types';
import { PortalNav } from '../../portal-nav';

export default function PortalHomePage() {
  const [data, setData] = useState<PortalHome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await portalApi<PortalHome>('/app/home'));
      setError(null);
    } catch (err) {
      setError(portalErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function pay() {
    if (!data?.loan) return;
    setPaying(true);
    setToast(null);
    try {
      const r = await portalApi<{ paymentId: string }>(`/app/loans/${data.loan.code}/pay`, {
        method: 'POST',
        body: {},
      });
      setToast('Check your phone for the MoMo prompt and enter your PIN.');
      for (let i = 0; i < 10; i++) {
        await new Promise((res) => setTimeout(res, 2000));
        const s = await portalApi<{ status: string; failureReason: string | null }>(
          `/app/payments/${r.paymentId}`,
        );
        if (s.status === 'SUCCESSFUL') {
          setToast('Payment received. Thank you!');
          break;
        }
        if (s.status === 'FAILED') {
          setToast(s.failureReason ?? 'The payment did not go through.');
          break;
        }
      }
      await load();
    } catch (err) {
      setToast(portalErrorMessage(err));
    } finally {
      setPaying(false);
    }
  }

  if (!data) {
    return (
      <>
        <main className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
          <p className="m-0 text-sm text-ink-muted">{error ?? 'Loading…'}</p>
          {error ? (
            <Button type="button" variant="secondary" onClick={load}>
              Try again
            </Button>
          ) : null}
        </main>
        <PortalNav />
      </>
    );
  }

  const loan = data.loan;
  const next = loan?.next;
  const late = next?.state === 'OVERDUE';

  return (
    <>
      <main className="flex flex-1 flex-col gap-5 p-5 pb-8">
        <header className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-full bg-forest/10 font-display font-semibold text-forest">
            {data.initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-xs text-ink-muted">Muraho,</p>
            <h1 className="m-0 truncate font-display text-2xl font-semibold tracking-[-0.02em]">
              {data.firstName}
            </h1>
          </div>
          <Link
            href="/portal/notifications"
            className="relative rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-ink no-underline"
          >
            Alerts
            {data.unread > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-amber" />
            ) : null}
          </Link>
        </header>

        {toast ? (
          <p className="m-0 rounded-lg border border-line bg-surface px-3 py-2 text-sm">{toast}</p>
        ) : null}

        {loan && next ? (
          <section className="flex flex-col gap-4 rounded-2xl bg-forest p-5 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="m-0 text-xs text-forest-muted">
                  Instalment {next.number} of {loan.instalmentCount} ·{' '}
                  {late ? 'was due' : 'due'} {formatDate(next.dueDate)}
                </p>
                <p className="m-0 mt-2 font-display text-[36px] leading-none font-semibold tabular-nums tracking-[-0.03em]">
                  <Money amount={next.amount} />
                </p>
              </div>
              <Pill tone={late ? 'danger' : 'lime'}>{late ? 'Overdue' : 'Due next'}</Pill>
            </div>
            <p className="m-0 text-sm text-forest-muted">
              {loan.repaidPercent}% repaid · <Money amount={loan.totalLeft} /> left
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="accent"
                disabled={paying || !!loan.pendingPayment}
                onClick={pay}
              >
                {paying
                  ? 'Waiting for MoMo…'
                  : loan.pendingPayment
                    ? 'Payment pending'
                    : 'Pay with MoMo'}
              </Button>
              <Link
                href={`/portal/schedule?loan=${loan.code}`}
                className="inline-flex items-center rounded-lg border border-white/25 px-4 py-2 text-sm font-semibold text-white no-underline"
              >
                Schedule
              </Link>
            </div>
          </section>
        ) : loan ? (
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="m-0 font-display text-lg font-semibold">Nothing due right now</h2>
            <p className="mt-1 mb-3 text-sm text-ink-muted">
              Loan {loan.code} · {loan.repaidPercent}% repaid
            </p>
            <Link
              href={`/portal/schedule?loan=${loan.code}`}
              className="text-sm font-semibold text-forest no-underline"
            >
              View schedule
            </Link>
          </section>
        ) : data.pendingLoan ? (
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="m-0 font-display text-lg font-semibold">Loan being prepared</h2>
            <p className="m-0 mt-1 text-sm text-ink-muted">
              {data.pendingLoan.code} will appear here once it is disbursed.
            </p>
          </section>
        ) : data.application ? (
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="m-0 font-display text-lg font-semibold">Application in review</h2>
            <p className="m-0 mt-1 text-sm text-ink-muted">
              {data.application.code} · {data.application.productName} ·{' '}
              <Money amount={data.application.amount} />
            </p>
          </section>
        ) : (
          <section className="rounded-2xl border border-line bg-surface p-5">
            <h2 className="m-0 font-display text-lg font-semibold">No active loan</h2>
            <p className="mt-1 mb-3 text-sm text-ink-muted">
              Apply for a loan when you are ready. We will text you when it is decided.
            </p>
            <Link href="/portal/apply">
              <Button type="button">Apply for a loan</Button>
            </Link>
          </section>
        )}

        {data.offer ? (
          <section className="rounded-xl border border-lime-deep/30 bg-lime/20 p-4">
            <p className="m-0 text-xs font-semibold text-forest">Pre-approved offer</p>
            <p className="m-0 mt-1 font-display text-lg font-semibold">
              Up to <Money amount={data.offer.maxAmount} /> · {data.offer.termMonths} months
            </p>
            <p className="m-0 text-sm text-ink-muted">{data.offer.productName}</p>
            <Link href="/portal/apply" className="mt-2 inline-block text-sm font-semibold text-forest">
              Use this offer
            </Link>
          </section>
        ) : null}

        {loan?.activity?.length ? (
          <section className="flex flex-col gap-2">
            <h2 className="m-0 text-sm font-semibold">Recent activity</h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {loan.activity.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line-soft px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{a.title}</div>
                    <div className="text-xs text-ink-muted">{a.when}</div>
                  </div>
                  <Money amount={a.amount} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <PortalNav unread={data.unread} />
    </>
  );
}
