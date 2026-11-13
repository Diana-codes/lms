import { addMonths, type IsoDate } from './dates';
import { assertBps, divRoundHalfUp, type Rwf } from './money';

/**
 * Reducing-balance, monthly repayment schedule (BUILD_BRIEF §5).
 *
 *   instalment = P·r / (1 − (1+r)^−n),   r = annual rate / 12
 *   interest   = opening balance × r     (rounded half up to a whole franc)
 *   principal  = instalment − interest
 *
 * Everything is integer arithmetic. The annuity factor is computed in
 * fixed-point bigint, so there is no float anywhere near a balance. Rounding
 * happens at two defined points: the level instalment, and each month's
 * interest. Whatever rounding leaves over lands in the final instalment, which
 * always clears the balance exactly.
 */

export interface ScheduleInput {
  principal: Rwf;
  /** Annual nominal rate in basis points. 17% = 1700. */
  annualRateBps: number;
  termMonths: number;
  /** Due date of instalment 1. Later instalments fall on the same day each month. */
  firstDueDate: IsoDate;
}

export interface ScheduleRow {
  number: number;
  dueDate: IsoDate;
  principal: Rwf;
  interest: Rwf;
  payment: Rwf;
  balanceAfter: Rwf;
}

export interface Schedule {
  /** The level instalment. The final row's payment can differ by a few francs. */
  instalment: Rwf;
  rows: ScheduleRow[];
  totalInterest: Rwf;
  totalPayable: Rwf;
}

const SCALE = 10n ** 30n;
const MONTHS_BPS = 12n * 10_000n;
export const MAX_TERM_MONTHS = 360;

function assertInput(principal: Rwf, annualRateBps: number, termMonths: number): void {
  if (principal <= 0n) throw new RangeError('Principal must be positive');
  assertBps(annualRateBps);
  if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > MAX_TERM_MONTHS) {
    throw new RangeError(`Term must be 1–${MAX_TERM_MONTHS} whole months`);
  }
}

/** One month's interest on a balance, rounded half up. */
export function monthlyInterest(balance: Rwf, annualRateBps: number): Rwf {
  assertBps(annualRateBps);
  return divRoundHalfUp(balance * BigInt(annualRateBps), MONTHS_BPS);
}

/** The level monthly instalment, rounded half up to a whole franc. */
export function calcInstalment(principal: Rwf, annualRateBps: number, termMonths: number): Rwf {
  assertInput(principal, annualRateBps, termMonths);
  if (annualRateBps === 0) return divRoundHalfUp(principal, BigInt(termMonths));

  // growth = (1 + r)^n in fixed point
  const onePlusR = SCALE + (SCALE * BigInt(annualRateBps)) / MONTHS_BPS;
  let growth = SCALE;
  for (let i = 0; i < termMonths; i++) growth = (growth * onePlusR) / SCALE;

  // P·r·(1+r)^n / ((1+r)^n − 1)
  const numerator = principal * BigInt(annualRateBps) * growth;
  const denominator = MONTHS_BPS * (growth - SCALE);
  return divRoundHalfUp(numerator, denominator);
}

export function buildSchedule(input: ScheduleInput): Schedule {
  const { principal, annualRateBps, termMonths, firstDueDate } = input;
  const instalment = calcInstalment(principal, annualRateBps, termMonths);

  const rows: ScheduleRow[] = [];
  let balance = principal;
  let totalInterest = 0n;

  for (let n = 1; n <= termMonths; n++) {
    const interest = monthlyInterest(balance, annualRateBps);
    const isLast = n === termMonths;
    // The final instalment takes whatever balance is left, so rounding
    // differences never leave a stray franc on the loan.
    let principalPart = isLast ? balance : instalment - interest;
    if (principalPart > balance) principalPart = balance;
    if (principalPart < 0n) principalPart = 0n;
    balance -= principalPart;
    totalInterest += interest;
    rows.push({
      number: n,
      dueDate: addMonths(firstDueDate, n - 1),
      principal: principalPart,
      interest,
      payment: principalPart + interest,
      balanceAfter: balance,
    });
  }

  return { instalment, rows, totalInterest, totalPayable: principal + totalInterest };
}

export interface RestructureQuote {
  newInstalment: Rwf;
  newTermMonths: number;
  /** Balance the new schedule starts from. */
  newPrincipal: Rwf;
  /** Change in the monthly instalment. Negative means it drops. */
  instalmentChange: Rwf;
  /** Extra interest over the life of the loan compared with carrying on as is. */
  extraInterest: Rwf;
}

export interface RestructureInput {
  outstandingPrincipal: Rwf;
  annualRateBps: number;
  currentInstalment: Rwf;
  remainingMonths: number;
}

/** Extend the term: recalculate from the outstanding balance over more months. */
export function quoteExtendTerm(input: RestructureInput, newTermMonths: number): RestructureQuote {
  if (newTermMonths <= input.remainingMonths) {
    throw new RangeError('New term must be longer than the remaining term');
  }
  const newInstalment = calcInstalment(
    input.outstandingPrincipal,
    input.annualRateBps,
    newTermMonths,
  );
  return {
    newInstalment,
    newTermMonths,
    newPrincipal: input.outstandingPrincipal,
    instalmentChange: newInstalment - input.currentInstalment,
    extraInterest:
      newInstalment * BigInt(newTermMonths) -
      input.currentInstalment * BigInt(input.remainingMonths),
  };
}

/**
 * One-month payment holiday: skip the next instalment, add that month's
 * interest to the balance (capitalise it), and spread the result over the
 * same number of remaining instalments.
 */
export function quotePaymentHoliday(input: RestructureInput): RestructureQuote & {
  capitalisedInterest: Rwf;
} {
  const capitalisedInterest = monthlyInterest(input.outstandingPrincipal, input.annualRateBps);
  const newPrincipal = input.outstandingPrincipal + capitalisedInterest;
  const newInstalment = calcInstalment(newPrincipal, input.annualRateBps, input.remainingMonths);
  return {
    newInstalment,
    newTermMonths: input.remainingMonths,
    newPrincipal,
    capitalisedInterest,
    instalmentChange: newInstalment - input.currentInstalment,
    extraInterest: (newInstalment - input.currentInstalment) * BigInt(input.remainingMonths),
  };
}
