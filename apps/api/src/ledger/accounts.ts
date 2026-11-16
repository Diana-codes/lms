import type { LedgerAccountType } from '../generated/prisma/client';

/**
 * Chart of accounts. Codes follow the usual numbering: 1xxx assets,
 * 2xxx liabilities, 3xxx equity, 4xxx income, 5xxx expenses.
 */
export const ACCOUNTS = {
  BANK: { code: '1000', name: 'Cash at bank', type: 'ASSET' },
  MOMO_FLOAT: { code: '1010', name: 'MTN MoMo float', type: 'ASSET' },
  BRANCH_CASH: { code: '1020', name: 'Cash at branch', type: 'ASSET' },
  AIRTEL_FLOAT: { code: '1030', name: 'Airtel Money float', type: 'ASSET' },
  LOANS_PRINCIPAL: { code: '1100', name: 'Loans receivable: principal', type: 'ASSET' },
  INTEREST_RECEIVABLE: { code: '1110', name: 'Interest receivable', type: 'ASSET' },
  FEES_RECEIVABLE: { code: '1120', name: 'Fees receivable', type: 'ASSET' },
  /**
   * Contra-asset: credit balance reduces net loans. Built up by PROVISION
   * postings under BNR 59/2023 Arts. 14–15.
   */
  LOAN_LOSS_ALLOWANCE: { code: '1190', name: 'Allowance for loan losses', type: 'ASSET' },
  BORROWER_CREDIT: { code: '2000', name: 'Borrower overpayments', type: 'LIABILITY' },
  VAT_PAYABLE: { code: '2100', name: 'VAT payable', type: 'LIABILITY' },
  /** Insurance premiums and other charges collected on someone else's behalf. */
  THIRD_PARTY_PAYABLE: { code: '2200', name: 'Collected for third parties', type: 'LIABILITY' },
  BORROWINGS: { code: '2300', name: 'Borrowings', type: 'LIABILITY' },
  ACCRUED_EXPENSES: { code: '2400', name: 'Accrued expenses and payables', type: 'LIABILITY' },
  FUNDING: { code: '3000', name: 'Lending capital', type: 'EQUITY' },
  RETAINED_EARNINGS: { code: '3100', name: 'Retained earnings', type: 'EQUITY' },
  /** Balances brought in from the lender's old records (PRD §6.14), to be reclassified. */
  OPENING_BALANCES: { code: '3900', name: 'Opening balances (migration)', type: 'EQUITY' },
  INTEREST_INCOME: { code: '4000', name: 'Interest income', type: 'INCOME' },
  FEE_INCOME: { code: '4010', name: 'Fee income', type: 'INCOME' },
  PENALTY_INCOME: { code: '4020', name: 'Penalty income', type: 'INCOME' },
  /** Money received after a loan was written off (reported separately, PRD §6.13). */
  RECOVERIES: { code: '4030', name: 'Recoveries on written-off loans', type: 'INCOME' },
  OTHER_INCOME: { code: '4090', name: 'Other income', type: 'INCOME' },
  WRITE_OFFS: { code: '5000', name: 'Loans written off', type: 'EXPENSE' },
  PROVISION_EXPENSE: { code: '5100', name: 'Loan loss provision expense', type: 'EXPENSE' },
  STAFF_COSTS: { code: '5200', name: 'Staff costs', type: 'EXPENSE' },
  RENT_UTILITIES: { code: '5210', name: 'Rent and utilities', type: 'EXPENSE' },
  IT_COMMS: { code: '5220', name: 'IT and communications', type: 'EXPENSE' },
  TRANSPORT: { code: '5230', name: 'Transport', type: 'EXPENSE' },
  PROFESSIONAL_FEES: { code: '5240', name: 'Professional fees', type: 'EXPENSE' },
  BANK_CHARGES: { code: '5250', name: 'Bank and MoMo charges', type: 'EXPENSE' },
  OTHER_EXPENSES: { code: '5290', name: 'Other operating expenses', type: 'EXPENSE' },
} as const satisfies Record<string, { code: string; name: string; type: LedgerAccountType }>;

export type AccountKey = keyof typeof ACCOUNTS;

/** Which cash account a payment channel settles into. */
export const CHANNEL_ACCOUNT = {
  MTN_MOMO: 'MOMO_FLOAT',
  AIRTEL_MONEY: 'AIRTEL_FLOAT',
  BANK_TRANSFER: 'BANK',
  CASH: 'BRANCH_CASH',
} as const satisfies Record<string, AccountKey>;

/**
 * Accounts that only loan events may move: manual journals cannot touch them,
 * so a loan's balance always matches its own history (PRD §10.3).
 */
export const CONTROL_ACCOUNT_CODES: ReadonlySet<string> = new Set([
  ACCOUNTS.LOANS_PRINCIPAL.code,
  ACCOUNTS.INTEREST_RECEIVABLE.code,
  ACCOUNTS.FEES_RECEIVABLE.code,
  ACCOUNTS.LOAN_LOSS_ALLOWANCE.code,
  ACCOUNTS.BORROWER_CREDIT.code,
  ACCOUNTS.WRITE_OFFS.code,
  ACCOUNTS.PROVISION_EXPENSE.code,
]);

/** Accounts money can be paid from or into (for the expense form). */
export const CASH_ACCOUNT_KEYS = [
  'BANK',
  'MOMO_FLOAT',
  'BRANCH_CASH',
  'AIRTEL_FLOAT',
] as const satisfies readonly AccountKey[];
