import { describe, expect, it } from 'vitest';
import {
  type AccountTotals,
  balanceSheet,
  incomeStatement,
  journalProblem,
  monthEnd,
  monthStart,
  normalBalance,
  trialBalance,
} from './accounting';

const acct = (
  code: string,
  type: AccountTotals['type'],
  debits: bigint,
  credits: bigint,
  name = code,
): AccountTotals => ({ code, name, type, debits, credits });

// Capital 10M in; 6M lent; 300K interest accrued and 200K collected;
// 50K rent paid; 120K provision with the allowance; 30K fee income.
const books: AccountTotals[] = [
  acct('1000', 'ASSET', 10_000_000n + 200_000n + 30_000n, 6_000_000n + 50_000n, 'Bank'),
  acct('1100', 'ASSET', 6_000_000n, 0n, 'Loans'),
  acct('1110', 'ASSET', 300_000n, 200_000n, 'Interest receivable'),
  acct('1190', 'ASSET', 0n, 120_000n, 'Allowance'),
  acct('3000', 'EQUITY', 0n, 10_000_000n, 'Capital'),
  acct('4000', 'INCOME', 0n, 300_000n, 'Interest income'),
  acct('4010', 'INCOME', 0n, 30_000n, 'Fees'),
  acct('5100', 'EXPENSE', 120_000n, 0n, 'Provision'),
  acct('5210', 'EXPENSE', 50_000n, 0n, 'Rent'),
  acct('5290', 'EXPENSE', 0n, 0n, 'Unused'),
];

describe('normalBalance', () => {
  it('is positive for a usual balance and negative for a contra account', () => {
    expect(normalBalance(books[1]!)).toBe(6_000_000n);
    expect(normalBalance(books[3]!)).toBe(-120_000n);
    expect(normalBalance(books[4]!)).toBe(10_000_000n);
  });
});

describe('trialBalance', () => {
  it('balances, leaves out zero accounts and sorts by code', () => {
    const tb = trialBalance([...books].reverse());
    expect(tb.balanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.rows.map((r) => r.code)).not.toContain('5290');
    expect(tb.rows[0]!.code).toBe('1000');
    expect(tb.rows.find((r) => r.code === '1190')).toMatchObject({ debit: 0n, credit: 120_000n });
  });

  it('notices when the books do not balance', () => {
    expect(trialBalance([acct('1000', 'ASSET', 5n, 0n)]).balanced).toBe(false);
  });
});

describe('incomeStatement', () => {
  it('nets income against expenses', () => {
    const is = incomeStatement(books);
    expect(is.totalIncome).toBe(330_000n);
    expect(is.totalExpenses).toBe(170_000n);
    expect(is.netProfit).toBe(160_000n);
    expect(is.expenses.map((e) => e.code)).toEqual(['5100', '5210']);
  });
});

describe('balanceSheet', () => {
  it('assets equal liabilities plus equity and current earnings', () => {
    const bs = balanceSheet(books);
    expect(bs.totalAssets).toBe(10_160_000n);
    expect(bs.currentEarnings).toBe(160_000n);
    expect(bs.totalEquity).toBe(10_160_000n);
    expect(bs.balanced).toBe(true);
    expect(bs.assets.find((a) => a.code === '1190')!.amount).toBe(-120_000n);
  });
});

describe('journalProblem', () => {
  const ok = [
    { accountCode: '5210', direction: 'DEBIT' as const, amount: 50_000n },
    { accountCode: '1000', direction: 'CREDIT' as const, amount: 50_000n },
  ];
  it('accepts a balanced journal', () => expect(journalProblem(ok)).toBeNull());
  it('refuses unbalanced, one-sided, zero and same-account journals', () => {
    expect(journalProblem([ok[0]!])).toMatch(/two lines/);
    expect(journalProblem([ok[0]!, { ...ok[1]!, amount: 40_000n }])).toMatch(/equal/);
    expect(journalProblem([ok[0]!, { ...ok[0]!, accountCode: '5220' }])).toMatch(
      /debit and one credit/,
    );
    expect(journalProblem([ok[0]!, { ...ok[1]!, amount: 0n }])).toMatch(/above zero/);
    expect(journalProblem([ok[0]!, { ...ok[1]!, accountCode: '5210' }])).toMatch(/both sides/);
  });
});

describe('month helpers', () => {
  it('finds the first and last day of a month', () => {
    expect(monthStart('2026-11-16')).toBe('2026-11-01');
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
    expect(monthEnd('2028-02-10')).toBe('2028-02-29');
    expect(monthEnd('2026-12-31')).toBe('2026-12-31');
  });
});
