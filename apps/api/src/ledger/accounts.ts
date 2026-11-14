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
  BORROWER_CREDIT: { code: '2000', name: 'Borrower overpayments', type: 'LIABILITY' },
  VAT_PAYABLE: { code: '2100', name: 'VAT payable', type: 'LIABILITY' },
  /** Insurance premiums and other charges collected on someone else's behalf. */
  THIRD_PARTY_PAYABLE: { code: '2200', name: 'Collected for third parties', type: 'LIABILITY' },
  FUNDING: { code: '3000', name: 'Lending capital', type: 'EQUITY' },
  INTEREST_INCOME: { code: '4000', name: 'Interest income', type: 'INCOME' },
  FEE_INCOME: { code: '4010', name: 'Fee income', type: 'INCOME' },
  PENALTY_INCOME: { code: '4020', name: 'Penalty income', type: 'INCOME' },
  WRITE_OFFS: { code: '5000', name: 'Loans written off', type: 'EXPENSE' },
} as const satisfies Record<string, { code: string; name: string; type: LedgerAccountType }>;

export type AccountKey = keyof typeof ACCOUNTS;

/** Which cash account a payment channel settles into. */
export const CHANNEL_ACCOUNT = {
  MTN_MOMO: 'MOMO_FLOAT',
  AIRTEL_MONEY: 'AIRTEL_FLOAT',
  BANK_TRANSFER: 'BANK',
  CASH: 'BRANCH_CASH',
} as const satisfies Record<string, AccountKey>;
