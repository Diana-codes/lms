'use client';

import { formatRwf } from '@kora/core';
import { Button, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { dateTime } from '@/lib/format';
import type { LoanDetail } from '@/lib/types';

const message = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Try again.';

/** "Request via MoMo" on the loan page. */
export function MomoRequestButton({ loan }: { loan: LoanDetail }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!loan.canRequestMomo || !loan.next) return null;
  const amount = BigInt(loan.next.amount);
  const pending = loan.pendingPayments.length > 0;

  async function request() {
    setBusy(true);
    try {
      await api(`/loans/${loan.code}/momo-request`, {
        method: 'POST',
        body: { amount: amount.toString() },
      });
      toast(`MoMo request for ${formatRwf(amount)} sent to ${loan.borrower.name}’s phone.`);
      router.refresh();
    } catch (err) {
      toast(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="secondary"
      loading={busy}
      disabled={pending}
      title={pending ? 'A request is already waiting' : undefined}
      onClick={request}
    >
      Request via MoMo
    </Button>
  );
}

/** The banner while a MoMo request waits for the borrower to approve it. */
export function PendingMomoBanner({ loan }: { loan: LoanDetail }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pending = loan.pendingPayments[0];
  if (!pending) return null;

  async function check() {
    setBusy(true);
    try {
      const r = await api<{ status: string }>(`/payments/${pending!.id}/check`, { method: 'POST' });
      toast(
        r.status === 'SUCCESSFUL'
          ? 'Payment confirmed by MoMo.'
          : r.status === 'FAILED'
            ? 'MoMo reports the request failed or was declined.'
            : 'Still waiting for the borrower to approve.',
      );
      router.refresh();
    } catch (err) {
      toast(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="MoMo request pending"
      className="flex flex-wrap items-center gap-4 rounded-[18px] border border-line bg-info-bg px-[18px] py-4 text-info-fg"
    >
      <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-1">
        <span className="text-sm font-semibold">
          Waiting for the borrower to approve {formatRwf(BigInt(pending.amount))} on their phone
        </span>
        <span className="text-[13px]">
          MoMo request sent {dateTime(pending.requestedAt)}. The payment is posted only once MoMo
          confirms it; we check every minute.
        </span>
      </div>
      <Button variant="secondary" loading={busy} onClick={check}>
        Check now
      </Button>
    </section>
  );
}
