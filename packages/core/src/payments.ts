import { daysBetween, type IsoDate } from './dates';
import type { Rwf } from './money';

/** What is owed and already paid on one instalment. */
export interface InstalmentBalance {
  number: number;
  principalDue: Rwf;
  interestDue: Rwf;
  principalPaid: Rwf;
  interestPaid: Rwf;
  /** Fees collected with the instalment and late charges on it (loans with product terms). */
  feeDue?: Rwf;
  feePaid?: Rwf;
  penaltyDue?: Rwf;
  penaltyPaid?: Rwf;
}

export interface InstalmentAllocation {
  number: number;
  principal: Rwf;
  interest: Rwf;
  /** True when this payment clears the instalment in full. */
  settles: boolean;
}

export interface PaymentAllocation {
  allocations: InstalmentAllocation[];
  principal: Rwf;
  interest: Rwf;
  /** Money left over once every instalment is cleared. Zero for a valid payment. */
  unallocated: Rwf;
}

/** Everything still owed on an instalment: principal, interest, fees and late charges. */
export function instalmentRemaining(i: InstalmentBalance): Rwf {
  return (
    i.principalDue -
    i.principalPaid +
    (i.interestDue - i.interestPaid) +
    ((i.feeDue ?? 0n) - (i.feePaid ?? 0n)) +
    ((i.penaltyDue ?? 0n) - (i.penaltyPaid ?? 0n))
  );
}

/**
 * Spread a payment over a loan's instalments: oldest instalment first, and
 * within an instalment interest before principal. Pass the instalments in
 * schedule order. Nothing is rounded; every franc lands somewhere.
 */
export function allocatePayment(instalments: InstalmentBalance[], amount: Rwf): PaymentAllocation {
  if (amount <= 0n) throw new RangeError('Payment amount must be positive');
  let left = amount;
  let principal = 0n;
  let interest = 0n;
  const allocations: InstalmentAllocation[] = [];

  for (const inst of instalments) {
    if (left === 0n) break;
    const interestOwed = inst.interestDue - inst.interestPaid;
    const principalOwed = inst.principalDue - inst.principalPaid;
    if (interestOwed <= 0n && principalOwed <= 0n) continue;

    const toInterest = left < interestOwed ? left : interestOwed;
    left -= toInterest;
    const toPrincipal = left < principalOwed ? left : principalOwed;
    left -= toPrincipal;

    interest += toInterest;
    principal += toPrincipal;
    allocations.push({
      number: inst.number,
      principal: toPrincipal,
      interest: toInterest,
      settles: toInterest === interestOwed && toPrincipal === principalOwed,
    });
  }

  return { allocations, principal, interest, unallocated: left };
}

/** Everything still owed on the schedule as it stands. */
export function totalRemaining(instalments: InstalmentBalance[]): Rwf {
  let total = 0n;
  for (const i of instalments) total += instalmentRemaining(i);
  return total;
}

export type InstalmentState = 'PAID' | 'PARTIAL' | 'OVERDUE' | 'DUE_NEXT' | 'UPCOMING';

export const INSTALMENT_STATE_LABELS: Record<InstalmentState, string> = {
  PAID: 'Paid',
  PARTIAL: 'Part paid',
  OVERDUE: 'Overdue',
  DUE_NEXT: 'Due next',
  UPCOMING: 'Upcoming',
};

/**
 * How an instalment shows on the schedule. `isFirstUnpaid` marks the oldest
 * instalment that still has something owing.
 */
export function instalmentState(
  inst: InstalmentBalance & { dueDate: IsoDate },
  today: IsoDate,
  isFirstUnpaid: boolean,
): InstalmentState {
  if (instalmentRemaining(inst) === 0n) return 'PAID';
  if (daysBetween(inst.dueDate, today) > 0) return 'OVERDUE';
  if (
    inst.principalPaid > 0n ||
    inst.interestPaid > 0n ||
    (inst.feePaid ?? 0n) > 0n ||
    (inst.penaltyPaid ?? 0n) > 0n
  ) {
    return 'PARTIAL';
  }
  return isFirstUnpaid ? 'DUE_NEXT' : 'UPCOMING';
}

export type PaymentTiming = 'EARLY' | 'ON_TIME' | 'LATE';

/** Whether an instalment was cleared before, on, or after its due date. */
export function paymentTiming(dueDate: IsoDate, paidOn: IsoDate): PaymentTiming {
  const diff = daysBetween(dueDate, paidOn);
  if (diff < 0) return 'EARLY';
  return diff === 0 ? 'ON_TIME' : 'LATE';
}
