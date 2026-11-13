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
