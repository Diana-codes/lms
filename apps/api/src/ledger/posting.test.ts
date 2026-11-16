import { describe, expect, it } from 'vitest';
import {
  balancedLines,
  disbursementLines,
  interestAccrualLines,
  provisionAdjustmentLines,
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

  it('interest accrual moves income onto the receivable', () => {
    expect(interestAccrualLines(63_750n)).toEqual([
      { account: 'INTEREST_RECEIVABLE', direction: 'DEBIT', amount: 63_750n },
      { account: 'INTEREST_INCOME', direction: 'CREDIT', amount: 63_750n },
    ]);
  });

  it('a repayment of accrued interest clears the receivable', () => {
    // Instalment 1 of LN-0418-2026, after the due-date accrual
    expect(repaymentLines(221_235n, 63_750n, 'MOMO_FLOAT', 63_750n)).toEqual([
      { account: 'MOMO_FLOAT', direction: 'DEBIT', amount: 284_985n },
      { account: 'LOANS_PRINCIPAL', direction: 'CREDIT', amount: 221_235n },
      { account: 'INTEREST_RECEIVABLE', direction: 'CREDIT', amount: 63_750n },
    ]);
  });

  it('interest paid before accrual is recognised as income on collection', () => {
    expect(repaymentLines(0n, 80_000n, 'MOMO_FLOAT', 0n)).toEqual([
      { account: 'MOMO_FLOAT', direction: 'DEBIT', amount: 80_000n },
      { account: 'INTEREST_INCOME', direction: 'CREDIT', amount: 80_000n },
    ]);
  });

  it('a mixed repayment clears accrued interest and recognises the rest', () => {
    expect(repaymentLines(100_000n, 50_000n, 'BANK', 30_000n)).toEqual([
      { account: 'BANK', direction: 'DEBIT', amount: 150_000n },
      { account: 'LOANS_PRINCIPAL', direction: 'CREDIT', amount: 100_000n },
      { account: 'INTEREST_RECEIVABLE', direction: 'CREDIT', amount: 30_000n },
      { account: 'INTEREST_INCOME', direction: 'CREDIT', amount: 20_000n },
    ]);
  });

  it('building the loan-loss allowance books provision expense', () => {
    expect(provisionAdjustmentLines(75_000n)).toEqual([
      { account: 'PROVISION_EXPENSE', direction: 'DEBIT', amount: 75_000n },
      { account: 'LOAN_LOSS_ALLOWANCE', direction: 'CREDIT', amount: 75_000n },
    ]);
  });

  it('releasing surplus allowance credits provision expense', () => {
    expect(provisionAdjustmentLines(-20_000n)).toEqual([
      { account: 'LOAN_LOSS_ALLOWANCE', direction: 'DEBIT', amount: 20_000n },
      { account: 'PROVISION_EXPENSE', direction: 'CREDIT', amount: 20_000n },
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
