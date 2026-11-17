import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  instalmentState,
  paymentTiming,
  totalRemaining,
  type InstalmentBalance,
} from './payments';
import { buildSchedule } from './schedule';

const schedule = buildSchedule({
  principal: 4_500_000n,
  annualRateBps: 1700,
  termMonths: 18,
  firstDueDate: '2026-06-04',
});
const fresh = (): InstalmentBalance[] =>
  schedule.rows.map((r) => ({
    number: r.number,
    principalDue: r.principal,
    interestDue: r.interest,
    principalPaid: 0n,
    interestPaid: 0n,
  }));

describe('allocatePayment', () => {
  it('clears one instalment with an exact payment', () => {
    const result = allocatePayment(fresh(), 284_985n);
    expect(result.allocations).toEqual([
      { number: 1, principal: 221_235n, interest: 63_750n, penalty: 0n, settles: true },
    ]);
    expect(result.unallocated).toBe(0n);
  });

  it('pays interest before principal on a part-payment', () => {
    const result = allocatePayment(fresh(), 80_000n);
    expect(result.allocations).toEqual([
      { number: 1, principal: 16_250n, interest: 63_750n, penalty: 0n, settles: false },
    ]);
    const tiny = allocatePayment(fresh(), 50_000n);
    expect(tiny.allocations[0]).toEqual({
      number: 1,
      principal: 0n,
      interest: 50_000n,
      penalty: 0n,
      settles: false,
    });
  });

  it('finishes a part-paid instalment before starting the next', () => {
    const rows = fresh();
    rows[0]!.interestPaid = 63_750n;
    rows[0]!.principalPaid = 16_250n;
    const result = allocatePayment(rows, 284_985n);
    expect(result.allocations[0]).toEqual({
      number: 1,
      principal: 204_985n,
      interest: 0n,
      penalty: 0n,
      settles: true,
    });
    expect(result.allocations[1]!.number).toBe(2);
    expect(result.allocations[1]!.settles).toBe(false);
    expect(result.principal + result.interest).toBe(284_985n);
  });

  it('spreads a large payment across instalments and skips paid ones', () => {
    const rows = fresh();
    rows[0]!.principalPaid = rows[0]!.principalDue;
    rows[0]!.interestPaid = rows[0]!.interestDue;
    const result = allocatePayment(rows, 284_985n * 2n);
    expect(result.allocations.map((a) => [a.number, a.settles])).toEqual([
      [2, true],
      [3, true],
    ]);
  });

  it('accounts for every franc', () => {
    const rows = fresh();
    for (const amount of [1n, 63_749n, 63_751n, 999_999n, 3_000_000n]) {
      const r = allocatePayment(rows, amount);
      expect(r.principal + r.interest + r.unallocated, String(amount)).toBe(amount);
      const sum = r.allocations.reduce((s, a) => s + a.principal + a.interest, 0n);
      expect(sum).toBe(r.principal + r.interest);
    }
  });

  it('reports what is left over when the loan is overpaid', () => {
    const rows = fresh();
    const owed = totalRemaining(rows);
    expect(owed).toBe(schedule.totalPayable);
    const result = allocatePayment(rows, owed + 500n);
    expect(result.unallocated).toBe(500n);
    expect(result.principal).toBe(4_500_000n);
    expect(result.allocations.every((a) => a.settles)).toBe(true);
  });

  it('pays late penalties first, then interest, then principal', () => {
    const rows = fresh();
    rows[0]!.penaltyDue = 5_700n;
    const part = allocatePayment(rows, 50_000n);
    expect(part.allocations[0]).toEqual({
      number: 1,
      principal: 0n,
      interest: 44_300n,
      penalty: 5_700n,
      settles: false,
    });
    const full = allocatePayment(rows, 284_985n + 5_700n);
    expect(full.allocations).toHaveLength(1);
    expect(full).toMatchObject({ penalty: 5_700n, interest: 63_750n, principal: 221_235n });
    expect(full.allocations[0]!.settles).toBe(true);
    expect(totalRemaining(rows)).toBe(schedule.totalPayable + 5_700n);
  });

  it('settles an instalment only when its penalties are paid too', () => {
    const rows = fresh();
    rows[0]!.principalPaid = rows[0]!.principalDue;
    rows[0]!.interestPaid = rows[0]!.interestDue;
    rows[0]!.penaltyDue = 5_700n;
    rows[0]!.penaltyPaid = 1_000n;
    const r = allocatePayment(rows, 4_700n);
    expect(r.allocations).toEqual([
      { number: 1, principal: 0n, interest: 0n, penalty: 4_700n, settles: true },
    ]);
  });

  it('rejects zero and negative amounts', () => {
    expect(() => allocatePayment(fresh(), 0n)).toThrow(RangeError);
    expect(() => allocatePayment(fresh(), -1n)).toThrow(RangeError);
  });
});

describe('instalment state', () => {
  const base = {
    number: 7,
    principalDue: 100n,
    interestDue: 10n,
    principalPaid: 0n,
    interestPaid: 0n,
  };
  it('follows the schedule in the loan detail design', () => {
    expect(
      instalmentState(
        { ...base, principalPaid: 100n, interestPaid: 10n, dueDate: '2026-11-04' },
        '2026-11-12',
        false,
      ),
    ).toBe('PAID');
    expect(instalmentState({ ...base, dueDate: '2026-12-04' }, '2026-11-12', true)).toBe(
      'DUE_NEXT',
    );
    expect(instalmentState({ ...base, dueDate: '2027-01-04' }, '2026-11-12', false)).toBe(
      'UPCOMING',
    );
  });
  it('marks unpaid instalments past their due date as overdue, even if part paid', () => {
    expect(instalmentState({ ...base, dueDate: '2026-11-11' }, '2026-11-12', true)).toBe('OVERDUE');
    expect(
      instalmentState({ ...base, interestPaid: 10n, dueDate: '2026-11-11' }, '2026-11-12', true),
    ).toBe('OVERDUE');
    expect(instalmentState({ ...base, dueDate: '2026-11-12' }, '2026-11-12', true)).toBe(
      'DUE_NEXT',
    );
    expect(
      instalmentState({ ...base, interestPaid: 5n, dueDate: '2026-12-04' }, '2026-11-12', true),
    ).toBe('PARTIAL');
  });
});

describe('payment timing', () => {
  it('compares the payment day with the due date', () => {
    expect(paymentTiming('2026-10-04', '2026-10-03')).toBe('EARLY');
    expect(paymentTiming('2026-11-04', '2026-11-04')).toBe('ON_TIME');
    expect(paymentTiming('2026-11-04', '2026-11-06')).toBe('LATE');
  });
});
