'use client';

import { formatBps, formatDate, formatRwf, FREQUENCY_UNIT, type LoanTerms } from '@kora/core';
import { Card, CardTitle, Table, Td, TextField, Th } from '@kora/ui';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { groupDigits } from '@/lib/format';
import type { QuoteResult } from '@/lib/types';

const rwf = (s: string) => formatRwf(BigInt(s));

/** A sample loan under the terms being edited, recalculated as they change. */
export function QuotePreview({
  terms,
  minAmount,
  maxAmount,
  minTermMonths,
  maxTermMonths,
  valid,
}: {
  terms: LoanTerms;
  minAmount: string;
  maxAmount: string;
  minTermMonths: number;
  maxTermMonths: number;
  valid: boolean;
}) {
  const [amount, setAmount] = useState(() => {
    const min = BigInt(minAmount || '0');
    const max = BigInt(maxAmount || '0');
    const pick = min <= 1_000_000n && max >= 1_000_000n ? 1_000_000n : min;
    return groupDigits(pick.toString());
  });
  const [term, setTerm] = useState(String(Math.min(Math.max(12, minTermMonths), maxTermMonths)));
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const body = JSON.stringify({
    terms,
    amount: amount.replace(/\D/g, ''),
    termMonths: Number(term),
  });
  useEffect(() => {
    if (!valid || !amount.replace(/\D/g, '') || !Number(term)) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const q = await api<QuoteResult>('/products/quote', {
          method: 'POST',
          body: JSON.parse(body),
        });
        if (!cancelled) {
          setQuote(q);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not calculate');
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [body, valid, amount, term]);

  const unit = FREQUENCY_UNIT[terms.frequency];
  const rows = quote?.rows ?? [];
  const shown = rows.length > 8 ? [...rows.slice(0, 6), ...rows.slice(-1)] : rows;

  return (
    <Card>
      <CardTitle>Sample loan</CardTitle>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Amount (RWF)"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(groupDigits(e.target.value))}
        />
        <TextField
          label="Term (months)"
          inputMode="numeric"
          value={term}
          onChange={(e) => setTerm(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      {!valid ? <p className="m-0 text-sm text-ink-muted">Fix the terms to see a sample.</p> : null}
      {error ? <p className="m-0 text-sm text-danger-fg">{error}</p> : null}
      {quote && valid ? (
        <>
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-muted">Paid out</dt>
            <dd className="m-0 text-right font-semibold tabular-nums">{rwf(quote.netDisbursed)}</dd>
            <dt className="text-ink-muted">
              {quote.instalmentCount} instalments, each {unit}
            </dt>
            <dd className="m-0 text-right font-semibold tabular-nums">{rwf(quote.instalment)}</dd>
            <dt className="text-ink-muted">Interest</dt>
            <dd className="m-0 text-right tabular-nums">{rwf(quote.totalInterest)}</dd>
            <dt className="text-ink-muted">Lender fees and VAT</dt>
            <dd className="m-0 text-right tabular-nums">
              {formatRwf(BigInt(quote.totalFees) - BigInt(quote.totalThirdParty))}
            </dd>
            <dt className="text-ink-muted">Total cost of credit</dt>
            <dd className="m-0 text-right tabular-nums">{rwf(quote.totalCostOfCredit)}</dd>
            {quote.totalThirdParty !== '0' ? (
              <>
                <dt className="text-ink-muted">Third-party charges</dt>
                <dd className="m-0 text-right tabular-nums">{rwf(quote.totalThirdParty)}</dd>
              </>
            ) : null}
            <dt className="text-ink-muted">Total repaid</dt>
            <dd className="m-0 text-right tabular-nums">{rwf(quote.totalRepayable)}</dd>
            <dt className="font-semibold">APR</dt>
            <dd className="m-0 text-right font-semibold tabular-nums">
              {formatBps(quote.aprBps, 2)}
            </dd>
          </dl>
          <p className="m-0 text-[13px] text-ink-muted">
            APR as in BNR&apos;s Key Facts Statement: interest and the lender&apos;s fees, not
            third-party charges. Effective annual rate {formatBps(quote.effectiveAnnualBps, 2)}.
          </p>
          <Table minWidth={360}>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Due</Th>
                <Th numeric>Payment</Th>
                <Th numeric>Balance</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.number}>
                  <Td>
                    {i === 6 && rows.length > 8 ? '… ' : ''}
                    {r.number}
                  </Td>
                  <Td>{formatDate(r.dueDate)}</Td>
                  <Td numeric>{formatRwf(BigInt(r.payment), { symbol: false })}</Td>
                  <Td numeric>{formatRwf(BigInt(r.balanceAfter), { symbol: false })}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      ) : null}
    </Card>
  );
}
