import { formatBps } from '../money';
import type {
  Component,
  FeeTiming,
  Frequency,
  InterestMethod,
  LoanTerms,
  OverpaymentRule,
  PayoffInterestRule,
  PenaltyMethod,
} from './terms';

export const INTEREST_METHOD_LABELS: Record<InterestMethod, string> = {
  DECLINING_EQUAL_INSTALMENT: 'Reducing balance, equal instalments',
  DECLINING_EQUAL_PRINCIPAL: 'Reducing balance, equal principal',
  FLAT: 'Flat rate',
  INTEREST_ONLY: 'Interest only, principal at the end',
};

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  WEEKLY: 'Weekly',
  FORTNIGHTLY: 'Every two weeks',
  MONTHLY: 'Monthly',
};

/** "a week", "a fortnight", "a month". */
export const FREQUENCY_UNIT: Record<Frequency, string> = {
  WEEKLY: 'week',
  FORTNIGHTLY: 'fortnight',
  MONTHLY: 'month',
};

export const FEE_TIMING_LABELS: Record<FeeTiming, string> = {
  DEDUCTED: 'Taken from the payout',
  UPFRONT: 'Paid before payout',
  FINANCED: 'Added to the loan',
  SPREAD: 'Spread over the instalments',
};

export const PENALTY_METHOD_LABELS: Record<PenaltyMethod, string> = {
  NONE: 'No late charges',
  FIXED_PER_INSTALMENT: 'Fixed amount per late instalment',
  PERCENT_OF_OVERDUE: 'One-off % of the overdue amount',
  DAILY_RATE_ON_OVERDUE: 'Daily interest on the overdue amount',
};

export const COMPONENT_LABELS: Record<Component, string> = {
  PENALTY: 'Late charges',
  FEE: 'Fees',
  INTEREST: 'Interest',
  PRINCIPAL: 'Principal',
};

export const OVERPAYMENT_LABELS: Record<OverpaymentRule, string> = {
  REDUCE_TERM: 'Repay principal early; the loan ends sooner',
  REDUCE_INSTALMENT: 'Repay principal early; instalments get smaller',
  PAY_AHEAD: 'Pay the next instalments in advance',
};

export const PAYOFF_INTEREST_LABELS: Record<PayoffInterestRule, string> = {
  ACCRUED_TO_DATE: 'Interest up to the payoff day only',
  CURRENT_PERIOD: "The current period's interest in full",
  ALL_SCHEDULED: 'All scheduled interest',
};

/** "24% a year, reducing balance" or "3% a month, flat". */
export function describeRate(
  terms: Pick<LoanTerms, 'rateBps' | 'ratePeriod' | 'interestMethod'>,
): string {
  const per = terms.ratePeriod === 'MONTH' ? 'a month' : 'a year';
  const method =
    terms.interestMethod === 'FLAT'
      ? 'flat'
      : terms.interestMethod === 'INTEREST_ONLY'
        ? 'interest only'
        : 'reducing balance';
  return `${formatBps(terms.rateBps, terms.rateBps % 100 === 0 ? 0 : 2)} ${per}, ${method}`;
}

/** One line per late-charge rule, e.g. "24% a year on the overdue amount, after 3 days". */
export function describePenalty(p: LoanTerms['penalty']): string {
  const after = p.graceDays ? `, after ${p.graceDays} ${p.graceDays === 1 ? 'day' : 'days'}` : '';
  switch (p.method) {
    case 'NONE':
      return 'No late charges';
    case 'FIXED_PER_INSTALMENT':
      return `RWF ${p.amount.toLocaleString('en-US')} per late instalment${after}`;
    case 'PERCENT_OF_OVERDUE':
      return `${formatBps(p.bps, p.bps % 100 === 0 ? 0 : 2)} of the overdue amount, once${after}`;
    case 'DAILY_RATE_ON_OVERDUE':
      return `${formatBps(p.bps, p.bps % 100 === 0 ? 0 : 2)} a year on the overdue amount, daily${after}`;
  }
}
