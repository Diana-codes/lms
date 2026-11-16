import type { Rwf } from './money';

/**
 * Financial statements from ledger balances (PRD §10.4). The API sums the
 * ledger per account; these functions only arrange those sums, so every
 * figure on a statement traces back to posted entries.
 */

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  INCOME: 'Income',
  EXPENSE: 'Expenses',
};

/** Which side increases an account of this type. */
export function normalSide(type: AccountType): 'DEBIT' | 'CREDIT' {
  return type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
}

/** Debit and credit totals for one account over some range of entries. */
export interface AccountTotals {
  code: string;
  name: string;
  type: AccountType;
  debits: Rwf;
  credits: Rwf;
}

/**
 * The balance in the account's normal direction: positive for a usual
 * balance, negative for an unusual one (a contra-asset such as the loan-loss
 * allowance shows as a negative asset).
 */
export function normalBalance(row: AccountTotals): Rwf {
  return normalSide(row.type) === 'DEBIT' ? row.debits - row.credits : row.credits - row.debits;
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  type: AccountType;
  debit: Rwf;
  credit: Rwf;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebit: Rwf;
  totalCredit: Rwf;
  balanced: boolean;
}

/** Each account's net balance in the debit or credit column; zero balances left out. */
export function trialBalance(accounts: AccountTotals[]): TrialBalance {
  const rows: TrialBalanceRow[] = [];
  let totalDebit = 0n;
  let totalCredit = 0n;
  for (const a of sortByCode(accounts)) {
    const net = a.debits - a.credits;
    if (net === 0n) continue;
    const row = {
      code: a.code,
      name: a.name,
      type: a.type,
      debit: net > 0n ? net : 0n,
      credit: net < 0n ? -net : 0n,
    };
    totalDebit += row.debit;
    totalCredit += row.credit;
    rows.push(row);
  }
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

export interface StatementLine {
  code: string;
  name: string;
  amount: Rwf;
}

export interface IncomeStatement {
  income: StatementLine[];
  expenses: StatementLine[];
  totalIncome: Rwf;
  totalExpenses: Rwf;
  /** Income less expenses. Negative is a loss. */
  netProfit: Rwf;
}

/** Income and expenses for a period, from the movements within that period. */
export function incomeStatement(movements: AccountTotals[]): IncomeStatement {
  const income = lines(movements, 'INCOME');
  const expenses = lines(movements, 'EXPENSE');
  const totalIncome = sum(income);
  const totalExpenses = sum(expenses);
  return { income, expenses, totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses };
}

export interface BalanceSheet {
  assets: StatementLine[];
  liabilities: StatementLine[];
  equity: StatementLine[];
  /** Income less expenses to date not yet moved to retained earnings. */
  currentEarnings: Rwf;
  totalAssets: Rwf;
  totalLiabilities: Rwf;
  /** Equity accounts plus current earnings. */
  totalEquity: Rwf;
  /** Assets equal liabilities plus equity, as they must for a balanced ledger. */
  balanced: boolean;
}

/** Position at a date, from all entries up to and including it. */
export function balanceSheet(balances: AccountTotals[]): BalanceSheet {
  const assets = lines(balances, 'ASSET');
  const liabilities = lines(balances, 'LIABILITY');
  const equity = lines(balances, 'EQUITY');
  const currentEarnings = sum(lines(balances, 'INCOME')) - sum(lines(balances, 'EXPENSE'));
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = sum(equity) + currentEarnings;
  return {
    assets,
    liabilities,
    equity,
    currentEarnings,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanced: totalAssets === totalLiabilities + totalEquity,
  };
}

export interface JournalLineInput {
  accountCode: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: Rwf;
}

/**
 * Why a manual journal cannot be posted, or null when it can: at least two
 * lines, positive amounts, debits equal to credits, and no account on both
 * sides of the same journal.
 */
export function journalProblem(lines: JournalLineInput[]): string | null {
  if (lines.length < 2) return 'A journal needs at least two lines';
  let debits = 0n;
  let credits = 0n;
  const sides = new Map<string, Set<string>>();
  for (const l of lines) {
    if (l.amount <= 0n) return 'Every line needs an amount above zero';
    if (l.direction === 'DEBIT') debits += l.amount;
    else credits += l.amount;
    const seen = sides.get(l.accountCode) ?? new Set<string>();
    seen.add(l.direction);
    sides.set(l.accountCode, seen);
  }
  for (const [code, seen] of sides) {
    if (seen.size > 1) return `Account ${code} is on both sides`;
  }
  if (debits === 0n || credits === 0n) return 'A journal needs at least one debit and one credit';
  if (debits !== credits) return 'Debits and credits must be equal';
  return null;
}

/** "2026-11-16" -> "2026-11-01". */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** The last day of the month that `date` falls in. */
export function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

function lines(rows: AccountTotals[], type: AccountType): StatementLine[] {
  return sortByCode(rows.filter((r) => r.type === type))
    .map((r) => ({ code: r.code, name: r.name, amount: normalBalance(r) }))
    .filter((l) => l.amount !== 0n);
}

function sum(rows: StatementLine[]): Rwf {
  return rows.reduce((s, r) => s + r.amount, 0n);
}

function sortByCode<T extends { code: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
}
