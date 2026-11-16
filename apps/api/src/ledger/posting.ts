import type { AccountKey } from './accounts';

export interface PostingLine {
  account: AccountKey;
  direction: 'DEBIT' | 'CREDIT';
  amount: bigint;
}

export class UnbalancedPostingError extends Error {}

/**
 * Check a set of ledger lines before it goes anywhere near the database:
 * at least two lines, every amount positive, debits equal to credits.
 * Zero-amount lines are dropped (a repayment with no interest part, say).
 * The database enforces the same rules again with triggers.
 */
export function balancedLines(lines: PostingLine[]): PostingLine[] {
  const kept = lines.filter((l) => l.amount !== 0n);
  let debits = 0n;
  let credits = 0n;
  for (const line of kept) {
    if (line.amount < 0n) {
      throw new UnbalancedPostingError(`Negative amount on ${line.account}`);
    }
    if (line.direction === 'DEBIT') debits += line.amount;
    else credits += line.amount;
  }
  if (kept.length < 2) throw new UnbalancedPostingError('A posting needs at least two lines');
  if (debits !== credits) {
    throw new UnbalancedPostingError(`Debits ${debits} do not equal credits ${credits}`);
  }
  return kept;
}

/** Disbursing a loan: the receivable goes up, the cash account goes down. */
export function disbursementLines(principal: bigint, cash: AccountKey): PostingLine[] {
  return balancedLines([
    { account: 'LOANS_PRINCIPAL', direction: 'DEBIT', amount: principal },
    { account: cash, direction: 'CREDIT', amount: principal },
  ]);
}

/**
 * Interest falling due: the receivable goes up and income is recognised.
 * Cash collection later clears the receivable (see repaymentLines).
 */
export function interestAccrualLines(interest: bigint): PostingLine[] {
  return balancedLines([
    { account: 'INTEREST_RECEIVABLE', direction: 'DEBIT', amount: interest },
    { account: 'INTEREST_INCOME', direction: 'CREDIT', amount: interest },
  ]);
}

/**
 * Move the loan-loss allowance toward the BNR 59/2023 required level.
 * Positive `delta` increases the allowance (expense); negative releases it.
 */
export function provisionAdjustmentLines(delta: bigint): PostingLine[] {
  if (delta === 0n) throw new UnbalancedPostingError('No provision adjustment');
  if (delta > 0n) {
    return balancedLines([
      { account: 'PROVISION_EXPENSE', direction: 'DEBIT', amount: delta },
      { account: 'LOAN_LOSS_ALLOWANCE', direction: 'CREDIT', amount: delta },
    ]);
  }
  const release = -delta;
  return balancedLines([
    { account: 'LOAN_LOSS_ALLOWANCE', direction: 'DEBIT', amount: release },
    { account: 'PROVISION_EXPENSE', direction: 'CREDIT', amount: release },
  ]);
}

/**
 * A repayment: cash comes in. Interest that was already accrued clears the
 * receivable; any interest not yet accrued (paid early, or never accrued
 * while suspended) is recognised as income on collection.
 */
export function repaymentLines(
  principal: bigint,
  interest: bigint,
  cash: AccountKey,
  accruedInterest = interest,
): PostingLine[] {
  const fromReceivable = accruedInterest > interest ? interest : accruedInterest;
  const asIncome = interest - fromReceivable;
  return balancedLines([
    { account: cash, direction: 'DEBIT', amount: principal + interest },
    { account: 'LOANS_PRINCIPAL', direction: 'CREDIT', amount: principal },
    { account: 'INTEREST_RECEIVABLE', direction: 'CREDIT', amount: fromReceivable },
    { account: 'INTEREST_INCOME', direction: 'CREDIT', amount: asIncome },
  ]);
}
