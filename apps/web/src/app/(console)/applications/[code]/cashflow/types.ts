import type { CashflowCategory } from '@kora/core';

type Digits = string;
export interface Figure {
  value: Digits;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  sources: string[];
}
export interface CashflowView {
  application: {
    code: string;
    borrowerName: string;
    productName: string;
    amount: Digits;
    dsrBps: number;
    verifiedIncome: Digits | null;
    incomeVerifiedAt: string | null;
  };
  aiAvailable: boolean;
  consent: { grantedAt: string; channel: string } | null;
  documents: Array<{
    id: string;
    kind: 'PAYSLIP' | 'BANK_STATEMENT' | 'MOMO_STATEMENT';
    fileName: string;
    size: number;
    status: 'UPLOADED' | 'READ' | 'UNREADABLE';
    extractor: string | null;
    holderName: string | null;
    payslip: { employer?: string; net?: Digits; gross?: Digits; payPeriod?: string } | null;
    error: string | null;
    createdAt: string;
  }>;
  analysis: null | {
    id: string;
    status: 'PROCESSING' | 'READY_FOR_REVIEW' | 'REVIEWED' | 'FAILED' | 'SUPERSEDED';
    modelVersion: string;
    error: string | null;
    createdAt: string;
    confirmedIncome: Digits | null;
    reviewNote: string | null;
    reviewedAt: string | null;
    report: null | {
      from: string | null;
      to: string | null;
      monthsCovered: number;
      months: Array<{ month: string; income: Digits; outflow: Digits }>;
      averageIncome: Figure;
      lowestMonthIncome: Digits;
      highestMonthIncome: Digits;
      monthsWithIncome: number;
      variationBps: number;
      incomeBySource: Array<{ category: CashflowCategory; total: Digits; shareBps: number }>;
      recurringCommitments: Figure;
      existingDebtRepayments: Figure;
      netDisposable: Figure;
      affordable: { low: Digits; high: Digits; dsrBps: number };
      payslipNet: Digits | null;
      salaryCredits: Digits | null;
      summary: string;
    };
    flags: Array<{
      id: string;
      code: string;
      severity: 'HIGH' | 'MEDIUM' | 'LOW';
      message: string;
      evidence: string[];
      outcome: 'PENDING' | 'DISMISSED' | 'CONFIRMED';
      outcomeNote: string | null;
    }>;
    transactions: Array<{
      id: string;
      documentId: string;
      date: string;
      description: string;
      amount: Digits;
      direction: 'IN' | 'OUT';
      balance: Digits | null;
      category: CashflowCategory;
      suggestedCategory: CashflowCategory;
      corrected: boolean;
    }>;
  };
}
