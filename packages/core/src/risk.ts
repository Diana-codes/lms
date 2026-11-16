import { daysBetween, type IsoDate } from './dates';
import { applyBps, ratioBps, type Rwf } from './money';

export const DPD_BUCKETS = ['CURRENT', 'DPD_1_30', 'DPD_31_90', 'DPD_90_PLUS'] as const;
export type DpdBucket = (typeof DPD_BUCKETS)[number];

export const DPD_BUCKET_LABELS: Record<DpdBucket, string> = {
  CURRENT: 'Current',
  DPD_1_30: '1–30 days late',
  DPD_31_90: '31–90 days late',
  DPD_90_PLUS: '90+ days late',
};

/**
 * Days past due = days since the oldest unpaid instalment's due date.
 * Zero when nothing is unpaid or the oldest unpaid instalment isn't due yet.
 */
export function daysPastDue(oldestUnpaidDueDate: IsoDate | null, today: IsoDate): number {
  if (!oldestUnpaidDueDate) return 0;
  return Math.max(0, daysBetween(oldestUnpaidDueDate, today));
}

export function dpdBucket(dpd: number): DpdBucket {
  if (dpd <= 0) return 'CURRENT';
  if (dpd <= 30) return 'DPD_1_30';
  if (dpd <= 90) return 'DPD_31_90';
  return 'DPD_90_PLUS';
}

/**
 * Days past due at which interest stops being recognised as income (BNR /
 * IFRS 9 practice for non-performing loans). Accrual resumes when the loan
 * cures below this threshold.
 */
export const INTEREST_ACCRUAL_SUSPEND_DPD = 91;

/** True when further interest accruals must not be posted. */
export function interestAccrualSuspended(dpd: number): boolean {
  return dpd >= INTEREST_ACCRUAL_SUSPEND_DPD;
}

/**
 * PAR 30 in basis points: outstanding principal of loans with DPD > 30,
 * divided by total outstanding principal.
 */
export function par30Bps(loans: Iterable<{ outstandingPrincipal: Rwf; dpd: number }>): number {
  let atRisk = 0n;
  let total = 0n;
  for (const loan of loans) {
    total += loan.outstandingPrincipal;
    if (loan.dpd > 30) atRisk += loan.outstandingPrincipal;
  }
  return ratioBps(atRisk, total);
}

/** Collection rate in basis points: collected ÷ due in the period. */
export function collectionRateBps(collected: Rwf, due: Rwf): number {
  return ratioBps(collected, due);
}

export const DEFAULT_AFFORDABILITY_BPS = 3500;

export interface AffordabilityResult {
  affordable: boolean;
  /** The most the borrower can pay each month under the rule. */
  maxInstalment: Rwf;
  /** Total instalments as a share of income, in basis points. */
  ratioBps: number;
}

/**
 * Affordability rule: all instalments (existing + new) must be at most
 * `limitBps` of verified monthly income. 35% by default, set per product.
 */
export function checkAffordability(input: {
  monthlyIncome: Rwf;
  newInstalment: Rwf;
  existingInstalments?: Rwf;
  limitBps?: number;
}): AffordabilityResult {
  const limit = input.limitBps ?? DEFAULT_AFFORDABILITY_BPS;
  const total = input.newInstalment + (input.existingInstalments ?? 0n);
  const maxInstalment = applyBps(input.monthlyIncome, limit);
  return {
    affordable: input.monthlyIncome > 0n && total <= maxInstalment,
    maxInstalment,
    ratioBps: ratioBps(total, input.monthlyIncome),
  };
}
