import { addDays, daysBetween, type IsoDate } from '../dates';
import { applyBps, divRoundHalfUp, type Rwf } from '../money';
import { amortise, periodInterest } from './schedule';
import type { Component, LoanTerms } from './terms';

/** What is owed and paid on one instalment. */
export interface InstalmentLedger {
  number: number;
  /** The day its period began: the previous due date, or disbursement. */
  periodStart: IsoDate;
  dueDate: IsoDate;
  principalDue: Rwf;
  principalPaid: Rwf;
  interestDue: Rwf;
  interestPaid: Rwf;
  feeDue: Rwf;
  feePaid: Rwf;
  penaltyDue: Rwf;
  penaltyPaid: Rwf;
}

export type ComponentAmounts = Record<Component, Rwf>;

const zero = (): ComponentAmounts => ({ PENALTY: 0n, FEE: 0n, INTEREST: 0n, PRINCIPAL: 0n });

export function owing(i: InstalmentLedger): ComponentAmounts {
  return {
    PENALTY: i.penaltyDue - i.penaltyPaid,
    FEE: i.feeDue - i.feePaid,
    INTEREST: i.interestDue - i.interestPaid,
    PRINCIPAL: i.principalDue - i.principalPaid,
  };
}

export function owingTotal(i: InstalmentLedger): Rwf {
  const o = owing(i);
  return o.PENALTY + o.FEE + o.INTEREST + o.PRINCIPAL;
}

const total = (a: ComponentAmounts) => a.PENALTY + a.FEE + a.INTEREST + a.PRINCIPAL;

// ── Late charges ───────────────────────────────────────────────────────────

export interface PenaltyInput {
  instalment: InstalmentLedger;
  terms: LoanTerms;
  /** Today. Charges are counted up to and including this day. */
  asOf: IsoDate;
  /** The last day penalties were counted to on this instalment, if any. */
  accruedThrough: IsoDate | null;
  /** Penalties already charged on the whole loan, for the cap. */
  chargedOnLoan: Rwf;
  /** The amount borrowed, for the cap. */
  loanPrincipal: Rwf;
}

/**
 * The late charge to add to an instalment today, and the day it now counts
 * to. Charges start the day after the grace period ends, are only ever on
 * overdue principal, interest (and fees, for a one-off percentage), never on
 * earlier penalties, and stop at the cap.
 */
export function penaltyToCharge(input: PenaltyInput): {
  charge: Rwf;
  accruedThrough: IsoDate | null;
} {
  const { instalment: inst, terms, asOf } = input;
  const rule = terms.penalty;
  const none = { charge: 0n, accruedThrough: input.accruedThrough };
  if (rule.method === 'NONE') return none;
  const graceEnd = addDays(inst.dueDate, rule.graceDays);
  if (daysBetween(graceEnd, asOf) <= 0) return none;
  const o = owing(inst);
  const overdue = o.PRINCIPAL + o.INTEREST;
  if (overdue <= 0n) return none;

  let charge = 0n;
  switch (rule.method) {
    case 'FIXED_PER_INSTALMENT':
      if (input.accruedThrough) return none;
      charge = BigInt(rule.amount);
      break;
    case 'PERCENT_OF_OVERDUE':
      if (input.accruedThrough) return none;
      charge = applyBps(overdue + o.FEE, rule.bps);
      break;
    case 'DAILY_RATE_ON_OVERDUE': {
      const from =
        input.accruedThrough && daysBetween(graceEnd, input.accruedThrough) > 0
          ? input.accruedThrough
          : graceEnd;
      const days = daysBetween(from, asOf);
      if (days <= 0) return none;
      charge = divRoundHalfUp(overdue * BigInt(rule.bps) * BigInt(days), 10_000n * 365n);
      break;
    }
  }
  if (rule.capBps != null) {
    const room = applyBps(input.loanPrincipal, rule.capBps) - input.chargedOnLoan;
    if (room <= 0n) charge = 0n;
    else if (charge > room) charge = room;
  }
  return { charge, accruedThrough: asOf };
}

// ── Allocating a payment ──────────────────────────────────────────────────

export interface Allocation {
  number: number;
  amounts: ComponentAmounts;
  /** True when the instalment is now fully paid. */
  settles: boolean;
}

/** Pay instalments oldest first; within each, components in the product's order. */
export function allocate(
  instalments: InstalmentLedger[],
  amount: Rwf,
  order: Component[],
): { allocations: Allocation[]; left: Rwf } {
  let left = amount;
  const allocations: Allocation[] = [];
  for (const inst of instalments) {
    if (left <= 0n) break;
    const due = owing(inst);
    if (total(due) <= 0n) continue;
    const amounts = zero();
    for (const c of order) {
      const take = left < due[c] ? left : due[c];
      if (take > 0n) {
        amounts[c] = take;
        left -= take;
      }
    }
    allocations.push({ number: inst.number, amounts, settles: total(amounts) === total(due) });
  }
  return { allocations, left };
}

// ── Paying off early ──────────────────────────────────────────────────────

export interface PayoffQuote {
  asOf: IsoDate;
  /** Everything already due and unpaid (all components). */
  arrears: ComponentAmounts;
  /** Interest for the period running today, under the product's payoff rule. */
  currentInterest: Rwf;
  /** Interest of later periods (only under ALL_SCHEDULED). */
  laterInterest: Rwf;
  /** Principal not yet due. */
  principal: Rwf;
  /** Early repayment fee and its VAT. */
  fee: Rwf;
  feeVat: Rwf;
  /** Interest and fees on the schedule that are not charged because the loan ends now. */
  waived: Rwf;
  total: Rwf;
}

/** What it takes to close the loan on `asOf`. Pass the live (unpaid) instalments in order. */
export function payoffQuote(
  instalments: InstalmentLedger[],
  terms: LoanTerms,
  asOf: IsoDate,
): PayoffQuote {
  const arrears = zero();
  let principal = 0n;
  let currentInterest = 0n;
  let laterInterest = 0n;
  let scheduledLater = 0n;
  let current: InstalmentLedger | undefined;

  for (const inst of instalments) {
    const o = owing(inst);
    if (daysBetween(inst.dueDate, asOf) >= 0) {
      for (const c of ['PENALTY', 'FEE', 'INTEREST', 'PRINCIPAL'] as const) arrears[c] += o[c];
      continue;
    }
    principal += o.PRINCIPAL;
    scheduledLater += o.INTEREST + o.FEE + o.PENALTY;
    if (!current) {
      current = inst;
      if (terms.payoff.interest === 'ACCRUED_TO_DATE') {
        const span = daysBetween(inst.periodStart, inst.dueDate);
        const run = Math.max(0, Math.min(span, daysBetween(inst.periodStart, asOf)));
        const accrued =
          span > 0 ? divRoundHalfUp(inst.interestDue * BigInt(run), BigInt(span)) : 0n;
        currentInterest = accrued > inst.interestPaid ? accrued - inst.interestPaid : 0n;
      } else {
        currentInterest = o.INTEREST;
      }
    } else if (terms.payoff.interest === 'ALL_SCHEDULED') {
      laterInterest += o.INTEREST;
    }
  }
  const fee = applyBps(principal, terms.payoff.feeBps);
  const feeVat = terms.payoff.feeVat ? applyBps(fee, terms.vatBps) : 0n;
  const charged = currentInterest + laterInterest;
  return {
    asOf,
    arrears,
    currentInterest,
    laterInterest,
    principal,
    fee,
    feeVat,
    waived: scheduledLater - charged > 0n ? scheduledLater - charged : 0n,
    total: total(arrears) + charged + principal + fee + feeVat,
  };
}

// ── Rescheduling after a principal prepayment ────────────────────────────

export interface FutureRow {
  number: number;
  periodStart: IsoDate;
  dueDate: IsoDate;
  principal: Rwf;
  interest: Rwf;
  fee: Rwf;
}

/**
 * New future instalments after part of the principal is repaid early.
 * REDUCE_TERM keeps the instalment and drops instalments from the end;
 * REDUCE_INSTALMENT keeps the count and lowers each instalment. Spread fees
 * stay on the instalments that remain.
 */
export function reschedule(
  future: FutureRow[],
  newBalance: Rwf,
  terms: LoanTerms,
  rule: 'REDUCE_TERM' | 'REDUCE_INSTALMENT',
): FutureRow[] {
  if (future.length === 0 || newBalance <= 0n) return [];
  const keep = (parts: Array<{ principal: Rwf; interest: Rwf }>): FutureRow[] =>
    parts.map((p, i) => ({ ...future[i]!, principal: p.principal, interest: p.interest }));

  if (rule === 'REDUCE_INSTALMENT' || terms.interestMethod === 'INTEREST_ONLY') {
    return keep(amortise(newBalance, terms, future.length, 0));
  }

  // REDUCE_TERM: same payment as now, until the balance is gone.
  const first = future[0]!;
  const out: Array<{ principal: Rwf; interest: Rwf }> = [];
  let balance = newBalance;
  for (let i = 0; i < future.length && balance > 0n; i++) {
    const row = future[i]!;
    let interest: Rwf;
    let part: Rwf;
    if (terms.interestMethod === 'FLAT') {
      interest = row.interest;
      part = first.principal > 0n ? first.principal : balance;
    } else if (terms.interestMethod === 'DECLINING_EQUAL_PRINCIPAL') {
      interest = periodInterest(balance, terms);
      part = first.principal > 0n ? first.principal : balance;
    } else {
      interest = periodInterest(balance, terms);
      part = first.principal + first.interest - interest;
    }
    if (i === future.length - 1 || part >= balance) part = balance;
    if (part < 0n) part = 0n;
    balance -= part;
    out.push({ principal: part, interest });
  }
  return keep(out);
}
