'use client';

import { formatRwf } from '@kora/core';
import { Button, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { BorrowerProfile } from '@/lib/types';

/** Sends a pre-approved top-up offer to the borrower's app and by SMS. */
export function OfferButton({ borrower }: { borrower: BorrowerProfile }) {
  const router = useRouter();
  const toast = useToast();
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const limit = borrower.totals.preApprovedLimit;
  if (!limit) return null;

  async function offer() {
    setState('busy');
    try {
      await api(`/borrowers/${borrower.code}/offers`, { method: 'POST' });
      setState('done');
      toast(
        `Top-up offer of up to ${formatRwf(BigInt(limit!))} sent to ${borrower.firstName}’s app and by SMS.`,
      );
      router.refresh();
    } catch (err) {
      setState('idle');
      toast(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <Button loading={state === 'busy'} disabled={state === 'done'} onClick={offer}>
      {state === 'done' ? 'Offer sent' : 'Offer top-up'}
    </Button>
  );
}
