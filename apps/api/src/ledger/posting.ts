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

/**
 * Disbursing a loan: the receivable goes up by the full principal. The cash
 * account pays out the principal less the origination fee, which is earned
 * as fee income straight away (it is deducted from the payout).
 */
export function disbursementLines(
  principal: bigint,
  cash: AccountKey,
  fee: bigint = 0n,
): PostingLine[] {
  if (fee < 0n || fee >= principal)
    throw new UnbalancedPostingError('Fee must be below the principal');
  return balancedLines([
    { account: 'LOANS_PRINCIPAL', direction: 'DEBIT', amount: principal },
    { account: cash, direction: 'CREDIT', amount: principal - fee },
    { account: 'FEE_INCOME', direction: 'CREDIT', amount: fee },
  ]);
}

/** Charging a late penalty: the borrower owes it now, and it is earned. */
export function penaltyChargeLines(amount: bigint): PostingLine[] {
  return balancedLines([
    { account: 'FEES_RECEIVABLE', direction: 'DEBIT', amount },
    { account: 'PENALTY_INCOME', direction: 'CREDIT', amount },
  ]);
}

/** Waiving a penalty: the charge is undone. */
export function penaltyWaiverLines(amount: bigint): PostingLine[] {
  return balancedLines([
    { account: 'PENALTY_INCOME', direction: 'DEBIT', amount },
    { account: 'FEES_RECEIVABLE', direction: 'CREDIT', amount },
  ]);
}

/** A repayment: cash comes in, split between principal and interest income. */
export function repaymentLines(
  principal: bigint,
  interest: bigint,
  cash: AccountKey,
): PostingLine[] {
  return balancedLines([
    { account: cash, direction: 'DEBIT', amount: principal + interest },
    { account: 'LOANS_PRINCIPAL', direction: 'CREDIT', amount: principal },
    { account: 'INTEREST_INCOME', direction: 'CREDIT', amount: interest },
  ]);
}
