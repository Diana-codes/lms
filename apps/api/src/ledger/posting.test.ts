import { describe, expect, it } from 'vitest';
import {
  balancedLines,
  disbursementLines,
  repaymentLines,
  UnbalancedPostingError,
} from './posting';

describe('ledger postings', () => {
  it('a disbursement moves principal from cash to the receivable', () => {
    expect(disbursementLines(4_500_000n, 'MOMO_FLOAT')).toEqual([
      { account: 'LOANS_PRINCIPAL', direction: 'DEBIT', amount: 4_500_000n },
      { account: 'MOMO_FLOAT', direction: 'CREDIT', amount: 4_500_000n },
    ]);
  });

  it('a repayment splits cash between principal and interest', () => {
    // Instalment 1 of LN-0418-2026
    expect(repaymentLines(221_235n, 63_750n, 'MOMO_FLOAT')).toEqual([
      { account: 'MOMO_FLOAT', direction: 'DEBIT', amount: 284_985n },
      { account: 'LOANS_PRINCIPAL', direction: 'CREDIT', amount: 221_235n },
      { account: 'INTEREST_INCOME', direction: 'CREDIT', amount: 63_750n },
    ]);
  });

  it('drops zero lines (an interest-only part-payment)', () => {
    expect(repaymentLines(0n, 80_000n, 'MOMO_FLOAT')).toEqual([
      { account: 'MOMO_FLOAT', direction: 'DEBIT', amount: 80_000n },
      { account: 'INTEREST_INCOME', direction: 'CREDIT', amount: 80_000n },
    ]);
  });

  it('refuses anything that does not balance', () => {
    expect(() =>
      balancedLines([
        { account: 'MOMO_FLOAT', direction: 'DEBIT', amount: 100n },
        { account: 'LOANS_PRINCIPAL', direction: 'CREDIT', amount: 99n },
      ]),
    ).toThrow(UnbalancedPostingError);
    expect(() =>
      balancedLines([{ account: 'MOMO_FLOAT', direction: 'DEBIT', amount: 100n }]),
    ).toThrow(UnbalancedPostingError);
    expect(() =>
      balancedLines([
        { account: 'MOMO_FLOAT', direction: 'DEBIT', amount: -5n },
        { account: 'LOANS_PRINCIPAL', direction: 'CREDIT', amount: -5n },
      ]),
    ).toThrow(UnbalancedPostingError);
    expect(() => repaymentLines(0n, 0n, 'MOMO_FLOAT')).toThrow(UnbalancedPostingError);
  });
});
