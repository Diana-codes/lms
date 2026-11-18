'use client';

import { describePenalty } from '@kora/core';
import {
  Button,
  Card,
  FormError,
  Modal,
  Money,
  TextAreaField,
  TextField,
  useToast,
} from '@kora/ui';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { LoanDetail, Me } from '@/lib/types';

/**
 * Late charges still owed on the loan, under its product's terms. A manager
 * can waive them, all or part, with a reason; the waiver is audited.
 */
export function LateChargesCard({ loan, me }: { loan: LoanDetail; me: Me }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isManager = me.role === 'MANAGER' || me.role === 'ADMIN';
  const owed = BigInt(loan.penaltiesOwed);
  if (owed <= 0n) return null;

  const digits = amount.replace(/[^\d]/g, '');

  async function waive() {
    setBusy(true);
    setError(null);
    try {
      await api(`/loans/${loan.code}/late-charges/waive`, {
        method: 'POST',
        body: { reason: reason.trim(), ...(digits ? { amount: digits } : {}) },
      });
      toast(`Late charges waived on ${loan.code}.`);
      setOpen(false);
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
        <h2 className="m-0 font-display text-base font-semibold">Late charges</h2>
        <span className="text-sm">
          Owed: <Money amount={loan.penaltiesOwed} className="font-semibold" />
        </span>
      </div>
      <p className="m-0 text-[13px] text-ink-muted">
        {describePenalty(loan.terms.penalty)}. Payments clear late charges first.
      </p>
      {isManager && loan.status === 'ACTIVE' ? (
        <Button
          variant="secondary"
          className="self-start"
          onClick={() => {
            setOpen(true);
            setReason('');
            setAmount('');
            setError(null);
          }}
        >
          Waive late charges
        </Button>
      ) : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Waive late charges"
        subtitle="Recorded in the audit log, with your name and reason."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} disabled={reason.trim().length < 5} onClick={waive}>
              Waive
            </Button>
          </>
        }
      >
        <TextField
          label="Amount (RWF)"
          hint="Leave empty to waive all of it"
          inputMode="numeric"
          placeholder={owed.toLocaleString('en-US')}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <TextAreaField
          label="Why are they waived?"
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
