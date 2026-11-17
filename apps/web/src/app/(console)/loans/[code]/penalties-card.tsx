'use client';

import { formatDate } from '@kora/core';
import { Button, Card, FormError, Modal, Money, TextAreaField, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { LoanDetail, Me } from '@/lib/types';

type Charge = LoanDetail['penalties'][number];

/**
 * Late penalties charged on this loan under its signed terms. A manager can
 * waive one with a reason; the waiver is posted to the ledger and audited.
 */
export function PenaltiesCard({ loan, me }: { loan: LoanDetail; me: Me }) {
  const router = useRouter();
  const toast = useToast();
  const [waiving, setWaiving] = useState<Charge | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isManager = me.role === 'MANAGER' || me.role === 'ADMIN';
  if (loan.penalties.length === 0) return null;

  async function waive() {
    if (!waiving) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/loans/${loan.code}/penalties/${waiving.id}/waive`, {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      toast(`Late penalty on instalment ${waiving.instalment} waived.`);
      setWaiving(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-3 p-[22px]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 font-display text-base font-semibold">Late penalties</h2>
        <span className="text-sm">
          Owed: <Money amount={loan.penaltiesOwed} className="font-semibold" />
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col p-0" aria-label="Late penalties">
        {loan.penalties.map((c) => {
          const waived = BigInt(c.waivedAmount) > 0n;
          return (
            <li key={c.id} className="flex flex-col gap-1.5 border-b border-line-soft py-2.5">
              <div className="flex items-center gap-3 text-sm">
                <span className="mr-auto">
                  Instalment {c.instalment} · {formatDate(c.chargedOn)}
                </span>
                <Money
                  amount={c.amount}
                  className={waived ? 'text-ink-muted line-through' : 'font-semibold'}
                />
              </div>
              {waived ? (
                <span className="text-xs text-ink-muted">
                  Waived <Money amount={c.waivedAmount} />
                  {c.waivedBy ? ` by ${c.waivedBy}` : ''}: {c.waiveReason}
                </span>
              ) : null}
              {c.canWaive && isManager ? (
                <Button
                  variant="secondary"
                  className="self-start"
                  onClick={() => {
                    setWaiving(c);
                    setReason('');
                    setError(null);
                  }}
                  aria-label={`Waive the late penalty on instalment ${c.instalment}`}
                >
                  Waive
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="m-0 text-xs text-ink-muted">
        {loan.terms.latePenaltyBps / 100}% of the overdue amount after {loan.terms.penaltyGraceDays}{' '}
        days, then every 30 days, as signed in the agreement. Payments clear penalties first.
      </p>

      <Modal
        open={waiving != null}
        onClose={() => setWaiving(null)}
        title={`Waive the penalty on instalment ${waiving?.instalment ?? ''}`}
        subtitle="Recorded in the ledger and the audit log, with your name and reason."
        footer={
          <>
            <Button variant="secondary" onClick={() => setWaiving(null)}>
              Cancel
            </Button>
            <Button loading={busy} disabled={reason.trim().length < 5} onClick={waive}>
              Waive penalty
            </Button>
          </>
        }
      >
        <TextAreaField
          label="Why is it waived?"
          placeholder="e.g. Borrower was in hospital; paid as soon as discharged"
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
        />
        <FormError>{error}</FormError>
      </Modal>
    </Card>
  );
}
