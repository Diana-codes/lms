/**
 * The rules a lender chooses for a loan product. A loan keeps a copy of the
 * terms it was issued under, so changing a product never changes existing
 * loans. Every amount is whole RWF; every rate is basis points (1% = 100).
 */

export const INTEREST_METHODS = [
  /** Equal instalments; interest on the reducing balance (annuity). */
  'DECLINING_EQUAL_INSTALMENT',
  /** Equal principal each period; interest on the reducing balance, so instalments fall. */
  'DECLINING_EQUAL_PRINCIPAL',
  /** Interest on the original amount every period. */
  'FLAT',
  /** Interest only, then all the principal with the last instalment (a bullet when there is one). */
  'INTEREST_ONLY',
] as const;
export type InterestMethod = (typeof INTEREST_METHODS)[number];

export const FREQUENCIES = ['WEEKLY', 'FORTNIGHTLY', 'MONTHLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const PERIODS_PER_YEAR: Record<Frequency, number> = {
  WEEKLY: 52,
  FORTNIGHTLY: 26,
  MONTHLY: 12,
};

export const RATE_PERIODS = ['YEAR', 'MONTH'] as const;
export type RatePeriod = (typeof RATE_PERIODS)[number];

export const FEE_TIMINGS = [
  /** Taken out of the money paid to the borrower. */
  'DEDUCTED',
  /** Paid by the borrower at disbursement, separately; the full amount is paid out. */
  'UPFRONT',
  /** Added to the amount borrowed, and repaid with it. */
  'FINANCED',
  /** Collected in equal parts with each instalment. */
  'SPREAD',
] as const;
export type FeeTiming = (typeof FEE_TIMINGS)[number];

export interface FeeRule {
  /** Short identifier, e.g. "processing". Unique within a product. */
  code: string;
  name: string;
  basis: 'PERCENT' | 'FIXED';
  /** Basis points of the amount borrowed (PERCENT), or whole RWF (FIXED). */
  value: number;
  /** Bounds for a PERCENT fee, in RWF. */
  min?: number | null;
  max?: number | null;
  timing: FeeTiming;
  /**
   * Collected for someone else (an insurer, a notary): not the lender's
   * income, and left out of the APR (BNR Regulation 91/2025).
   */
  thirdParty: boolean;
  /** VAT is added on top. Loan interest and late penalties are VAT-exempt in Rwanda; fees are not. */
  vat: boolean;
}

export const PENALTY_METHODS = [
  'NONE',
  /** A fixed amount, once, for each instalment still unpaid after the grace days. */
  'FIXED_PER_INSTALMENT',
  /** A percentage of what is overdue on the instalment, once, after the grace days. */
  'PERCENT_OF_OVERDUE',
  /** An annual rate on the overdue principal and interest, charged daily after the grace days. */
  'DAILY_RATE_ON_OVERDUE',
] as const;
export type PenaltyMethod = (typeof PENALTY_METHODS)[number];

export interface PenaltyRule {
  method: PenaltyMethod;
  /** Days after the due date before any charge. */
  graceDays: number;
  /** RWF, for FIXED_PER_INSTALMENT. */
  amount: number;
  /** Basis points: of the overdue amount (PERCENT_OF_OVERDUE) or per year (DAILY_RATE_ON_OVERDUE). */
  bps: number;
  /** All penalties on a loan together never exceed this share of the amount borrowed. Null: no cap. */
  capBps: number | null;
}

export const COMPONENTS = ['PENALTY', 'FEE', 'INTEREST', 'PRINCIPAL'] as const;
export type Component = (typeof COMPONENTS)[number];

export const OVERPAYMENT_RULES = [
  /** Extra money pays principal and the loan ends sooner; instalments stay the same. */
  'REDUCE_TERM',
  /** Extra money pays principal and the remaining instalments get smaller. */
  'REDUCE_INSTALMENT',
  /** Extra money pays the next instalments in advance, as they stand. */
  'PAY_AHEAD',
] as const;
export type OverpaymentRule = (typeof OVERPAYMENT_RULES)[number];

export const PAYOFF_INTEREST_RULES = [
  /** Interest up to the payoff day only (pro rata for the current period). */
  'ACCRUED_TO_DATE',
  /** The current period's interest in full. */
  'CURRENT_PERIOD',
  /** All the interest the schedule would have charged. */
  'ALL_SCHEDULED',
] as const;
export type PayoffInterestRule = (typeof PAYOFF_INTEREST_RULES)[number];

export const ROUNDING_UNITS = [1, 10, 50, 100] as const;
export type RoundingUnit = (typeof ROUNDING_UNITS)[number];

export interface LoanTerms {
  interestMethod: InterestMethod;
  /** The nominal rate, per `ratePeriod`, in basis points. */
  rateBps: number;
  ratePeriod: RatePeriod;
  frequency: Frequency;
  /**
   * Monthly loans only: every instalment falls on this day of the month
   * (1–28), with the first period's interest charged for its actual length.
   * Null: each instalment one period after the last, starting from disbursement.
   */
  dueDayOfMonth: number | null;
  /** Instalments falling on a weekend or public holiday move to the next working day. */
  moveOffNonWorkingDays: boolean;
  /** Interest-only periods at the start before principal repayment begins. */
  principalGracePeriods: number;
  fees: FeeRule[];
  /** The VAT rate for fees marked `vat`. Rwanda: 18%. */
  vatBps: number;
  penalty: PenaltyRule;
  /** What a payment pays first, within each instalment (oldest instalment first). */
  allocationOrder: Component[];
  overpayment: OverpaymentRule;
  payoff: {
    interest: PayoffInterestRule;
    /** Early repayment fee, basis points of the principal repaid early. */
    feeBps: number;
    feeVat: boolean;
  };
  /** Instalments are rounded to this many francs; the last instalment absorbs the difference. */
  roundingUnit: RoundingUnit;
}

/** Rwanda's standard VAT rate (Law 049/2023, Art. 4). */
export const RW_VAT_BPS = 1800;

/**
 * Starting terms for a new product in Rwanda: common market practice and
 * BNR rules (see docs and PRD Appendix A). Every value is a setting the
 * lender can change.
 */
export const RW_DEFAULT_TERMS: LoanTerms = {
  interestMethod: 'DECLINING_EQUAL_INSTALMENT',
  rateBps: 2400,
  ratePeriod: 'YEAR',
  frequency: 'MONTHLY',
  dueDayOfMonth: null,
  moveOffNonWorkingDays: true,
  principalGracePeriods: 0,
  fees: [
    {
      code: 'processing',
      name: 'Processing fee',
      basis: 'PERCENT',
      value: 200,
      min: null,
      max: null,
      timing: 'DEDUCTED',
      thirdParty: false,
      vat: true,
    },
  ],
  vatBps: RW_VAT_BPS,
  penalty: {
    method: 'DAILY_RATE_ON_OVERDUE',
    graceDays: 3,
    amount: 0,
    bps: 2400,
    capBps: null,
  },
  allocationOrder: ['PENALTY', 'FEE', 'INTEREST', 'PRINCIPAL'],
  overpayment: 'REDUCE_TERM',
  payoff: { interest: 'ACCRUED_TO_DATE', feeBps: 0, feeVat: true },
  roundingUnit: 1,
};

/**
 * Loans issued before products had their own terms: equal monthly
 * instalments at the loan's annual rate, no fees, no late charges, and extra
 * money paying the next instalments ahead. Their schedules were built this way.
 */
export function legacyTerms(annualRateBpsValue: number): LoanTerms {
  return {
    ...RW_DEFAULT_TERMS,
    rateBps: annualRateBpsValue,
    ratePeriod: 'YEAR',
    moveOffNonWorkingDays: false,
    fees: [],
    penalty: { method: 'NONE', graceDays: 0, amount: 0, bps: 0, capBps: null },
    overpayment: 'PAY_AHEAD',
    payoff: { interest: 'ALL_SCHEDULED', feeBps: 0, feeVat: false },
  };
}

/**
 * How many instalments a term of whole months has. Terms are agreed in
 * months whatever the frequency: 6 months repaid weekly is 26 instalments.
 */
export function instalmentCount(termMonths: number, frequency: Frequency): number {
  if (frequency === 'MONTHLY') return termMonths;
  return Math.max(1, Math.round((termMonths * PERIODS_PER_YEAR[frequency]) / 12));
}

/** An instalment expressed per month, for affordability checks. */
export function monthlyEquivalent(instalment: bigint, frequency: Frequency): bigint {
  if (frequency === 'MONTHLY') return instalment;
  const ppy = BigInt(PERIODS_PER_YEAR[frequency]);
  return (instalment * ppy + 6n) / 12n;
}

/** The nominal annual rate in basis points. */
export function annualRateBps(terms: Pick<LoanTerms, 'rateBps' | 'ratePeriod'>): number {
  return terms.ratePeriod === 'MONTH' ? terms.rateBps * 12 : terms.rateBps;
}

export class InvalidTermsError extends RangeError {}

const isWhole = (n: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;

/** Check terms are complete and consistent. Returns a list of problems; empty when valid. */
export function termsProblems(terms: LoanTerms, termCount?: number): string[] {
  const problems: string[] = [];
  if (!INTEREST_METHODS.includes(terms.interestMethod)) problems.push('Unknown interest method');
  if (!FREQUENCIES.includes(terms.frequency)) problems.push('Unknown repayment frequency');
  if (!RATE_PERIODS.includes(terms.ratePeriod)) problems.push('Unknown rate period');
  if (!isWhole(terms.rateBps, 0, 100_000)) problems.push('Interest rate must be 0–1,000%');
  if (terms.dueDayOfMonth != null) {
    if (terms.frequency !== 'MONTHLY')
      problems.push('A fixed due day only works for monthly loans');
    if (!isWhole(terms.dueDayOfMonth, 1, 28)) problems.push('The due day must be 1–28');
  }
  if (!isWhole(terms.principalGracePeriods, 0, 120)) problems.push('Grace periods must be 0–120');
  if (termCount != null && terms.principalGracePeriods >= termCount) {
    problems.push('Grace periods must be fewer than the number of instalments');
  }
  if (!isWhole(terms.vatBps, 0, 10_000)) problems.push('VAT rate must be 0–100%');
  const codes = new Set<string>();
  for (const fee of terms.fees) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(fee.code))
      problems.push(`Fee code "${fee.code}" is not valid`);
    if (codes.has(fee.code)) problems.push(`Fee code "${fee.code}" is used twice`);
    codes.add(fee.code);
    if (!fee.name?.trim()) problems.push('Every fee needs a name');
    if (!FEE_TIMINGS.includes(fee.timing)) problems.push(`Fee "${fee.name}": unknown timing`);
    if (fee.basis === 'PERCENT' && !isWhole(fee.value, 0, 10_000)) {
      problems.push(`Fee "${fee.name}": percentage must be 0–100%`);
    }
    if (fee.basis === 'FIXED' && !isWhole(fee.value)) {
      problems.push(`Fee "${fee.name}": amount must be whole francs`);
    }
    if (fee.min != null && !isWhole(fee.min)) problems.push(`Fee "${fee.name}": minimum not valid`);
    if (fee.max != null && !isWhole(fee.max)) problems.push(`Fee "${fee.name}": maximum not valid`);
    if (fee.min != null && fee.max != null && fee.min > fee.max) {
      problems.push(`Fee "${fee.name}": minimum is above maximum`);
    }
  }
  const p = terms.penalty;
  if (!PENALTY_METHODS.includes(p.method)) problems.push('Unknown penalty method');
  if (!isWhole(p.graceDays, 0, 365)) problems.push('Penalty grace days must be 0–365');
  if (!isWhole(p.amount)) problems.push('Penalty amount must be whole francs');
  if (!isWhole(p.bps, 0, 100_000)) problems.push('Penalty rate is not valid');
  if (p.capBps != null && !isWhole(p.capBps, 0, 100_000)) problems.push('Penalty cap is not valid');
  if (p.method === 'FIXED_PER_INSTALMENT' && p.amount <= 0) {
    problems.push('Set the penalty amount');
  }
  if ((p.method === 'PERCENT_OF_OVERDUE' || p.method === 'DAILY_RATE_ON_OVERDUE') && p.bps <= 0) {
    problems.push('Set the penalty rate');
  }
  const order = [...terms.allocationOrder].sort().join();
  if (order !== [...COMPONENTS].sort().join()) {
    problems.push('Payment order must list penalty, fee, interest and principal once each');
  }
  if (!OVERPAYMENT_RULES.includes(terms.overpayment)) problems.push('Unknown overpayment rule');
  if (!PAYOFF_INTEREST_RULES.includes(terms.payoff.interest)) problems.push('Unknown payoff rule');
  if (!isWhole(terms.payoff.feeBps, 0, 10_000)) problems.push('Early repayment fee is not valid');
  if (!ROUNDING_UNITS.includes(terms.roundingUnit))
    problems.push('Rounding must be 1, 10, 50 or 100');
  return problems;
}

export function assertTerms(terms: LoanTerms, termCount?: number): void {
  const problems = termsProblems(terms, termCount);
  if (problems.length) throw new InvalidTermsError(problems.join('; '));
}
