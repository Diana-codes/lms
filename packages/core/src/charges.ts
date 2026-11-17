import { addDays, daysBetween, type IsoDate } from './dates';
import { applyBps, type Rwf } from './money';
import { buildSchedule } from './schedule';

/**
 * Fees, late penalties and the true cost of a loan.
 *
 * - The origination fee is a share of the principal, deducted from what is
 *   paid out: the borrower receives principal − fee and repays the principal.
 * - A late penalty is a share of the overdue principal and interest on an
 *   instalment. The first is charged once the instalment is more than
 *   `graceDays` late, then again every `PENALTY_PERIOD_DAYS` while it stays
 *   unpaid. Penalties are never charged on penalties.
 */

export const PENALTY_PERIOD_DAYS = 30;
export const DEFAULT_PENALTY_GRACE_DAYS = 5;

export function originationFee(principal: Rwf, feeBps: number): Rwf {
  return applyBps(principal, feeBps);
}

/** How many penalty charges an instalment due on `dueDate` has earned by `today`. */
export function penaltyChargesDue(
  dueDate: IsoDate,
  today: IsoDate,
  graceDays: number = DEFAULT_PENALTY_GRACE_DAYS,
): number {
  const late = daysBetween(dueDate, today);
  if (late <= graceDays) return 0;
  return Math.floor((late - graceDays - 1) / PENALTY_PERIOD_DAYS) + 1;
}

/** The day charge number `n` (1, 2, …) falls due for an instalment. */
export function penaltyChargeDate(
  dueDate: IsoDate,
  n: number,
  graceDays: number = DEFAULT_PENALTY_GRACE_DAYS,
): IsoDate {
  return addDays(dueDate, graceDays + 1 + (n - 1) * PENALTY_PERIOD_DAYS);
}

export function penaltyAmount(overdue: Rwf, penaltyBps: number): Rwf {
  return overdue > 0n ? applyBps(overdue, penaltyBps) : 0n;
}

export interface CostOfCredit {
  principal: Rwf;
  fee: Rwf;
  /** What actually reaches the borrower's wallet. */
  netDisbursed: Rwf;
  instalment: Rwf;
  termMonths: number;
  totalInterest: Rwf;
  /** Everything the borrower repays: principal plus interest. */
  totalRepayable: Rwf;
  /** Interest plus fees: what the loan costs. */
  totalCost: Rwf;
  /** The annual rate including fees, in basis points. */
  aprBps: number;
}

/**
 * The figures a borrower must see before agreeing: the Key Facts.
 *
 * APR is the yearly rate at which what the borrower receives equals the
 * present value of what they repay, quoted the same way as the interest rate
 * (monthly rate × 12). It is a disclosure rate, not a balance, so it is
 * solved in floating point; every money figure stays an integer.
 */
export function costOfCredit(input: {
  principal: Rwf;
  annualRateBps: number;
  termMonths: number;
  feeBps: number;
}): CostOfCredit {
  const schedule = buildSchedule({
    principal: input.principal,
    annualRateBps: input.annualRateBps,
    termMonths: input.termMonths,
    firstDueDate: '2000-02-01',
  });
  const fee = originationFee(input.principal, input.feeBps);
  const net = input.principal - fee;
  const payments = schedule.rows.map((r) => Number(r.payment));
  const target = Number(net);
  const pv = (r: number) => payments.reduce((sum, p, k) => sum + p / (1 + r) ** (k + 1), 0);

  // PV falls as the rate rises; bisect between 0% and 100% a month.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > target) lo = mid;
    else hi = mid;
  }
  const monthly = (lo + hi) / 2;

  return {
    principal: input.principal,
    fee,
    netDisbursed: net,
    instalment: schedule.instalment,
    termMonths: input.termMonths,
    totalInterest: schedule.totalInterest,
    totalRepayable: schedule.totalPayable,
    totalCost: schedule.totalInterest + fee,
    aprBps: Math.round(monthly * 12 * 10_000),
  };
}
