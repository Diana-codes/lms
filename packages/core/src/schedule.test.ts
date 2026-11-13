import { describe, expect, it } from 'vitest';
import {
  buildSchedule,
  calcInstalment,
  monthlyInterest,
  quoteExtendTerm,
  quotePaymentHoliday,
} from './schedule';
import { sumRwf } from './money';

/** The float formula from LoanDetail.dc.html, used only as an independent check. */
function floatInstalment(p: number, annualRate: number, n: number): number {
  const r = annualRate / 12;
  return (p * r) / (1 - Math.pow(1 + r, -n));
}

describe('calcInstalment', () => {
  it('matches the brief: RWF 4,500,000 at 17% for 18 months is RWF 284,985', () => {
    expect(calcInstalment(4_500_000n, 1700, 18)).toBe(284_985n);
  });

  it('agrees with the design formula across products in the pipeline', () => {
    const cases: Array<[bigint, number, number]> = [
      [3_000_000n, 1800, 12],
      [850_000n, 2100, 6],
      [12_000_000n, 1600, 36],
      [1_850_000n, 1500, 9],
      [9_400_000n, 1700, 24],
      [600_000n, 1200, 3],
      [7_800_000n, 1600, 24],
      [2_100_000n, 1500, 12],
      [1_500_000n, 2000, 18],
      [1n, 1700, 1],
      [999_999_999_999n, 3650, 360],
    ];
    for (const [p, bps, n] of cases) {
      const expected = BigInt(Math.round(floatInstalment(Number(p), bps / 10_000, n)));
      const actual = calcInstalment(p, bps, n);
      const diff = actual > expected ? actual - expected : expected - actual;
      // Floats lose precision on the largest case; whole francs must agree otherwise.
      expect(diff <= (p > 10n ** 11n ? 5n : 0n), `${p} @ ${bps}bps x ${n}`).toBe(true);
    }
  });

  it('splits evenly at 0%', () => {
    expect(calcInstalment(1_200_000n, 0, 12)).toBe(100_000n);
    expect(calcInstalment(1_000_000n, 0, 3)).toBe(333_333n);
  });

  it('rejects bad input', () => {
    expect(() => calcInstalment(0n, 1700, 12)).toThrow(RangeError);
    expect(() => calcInstalment(-5n, 1700, 12)).toThrow(RangeError);
    expect(() => calcInstalment(1000n, -1, 12)).toThrow(RangeError);
    expect(() => calcInstalment(1000n, 17.5, 12)).toThrow(RangeError);
    expect(() => calcInstalment(1000n, 1700, 0)).toThrow(RangeError);
    expect(() => calcInstalment(1000n, 1700, 1.5)).toThrow(RangeError);
    expect(() => calcInstalment(1000n, 1700, 361)).toThrow(RangeError);
  });
});

describe('buildSchedule', () => {
  const loan = buildSchedule({
    principal: 4_500_000n,
    annualRateBps: 1700,
    termMonths: 18,
    firstDueDate: '2026-06-04',
  });

  it('reproduces the loan detail design (LN-0418-2026)', () => {
    expect(loan.instalment).toBe(284_985n);
    expect(loan.rows).toHaveLength(18);
    // Row 1: interest = 4,500,000 × 17% / 12 = 63,750
    expect(loan.rows[0]).toEqual({
      number: 1,
      dueDate: '2026-06-04',
      principal: 221_235n,
      interest: 63_750n,
      payment: 284_985n,
      balanceAfter: 4_278_765n,
    });
    expect(loan.rows[6]?.dueDate).toBe('2026-12-04');
    expect(loan.rows[17]?.dueDate).toBe('2027-11-04');
  });

  it('clears the balance exactly, with the rounding difference in the final instalment', () => {
    const last = loan.rows[17]!;
    expect(last.balanceAfter).toBe(0n);
    expect(sumRwf(loan.rows.map((r) => r.principal))).toBe(4_500_000n);
    for (const row of loan.rows.slice(0, -1)) expect(row.payment).toBe(284_985n);
    const drift = last.payment - loan.instalment;
    expect(drift > -18n && drift < 18n).toBe(true);
  });

  it('keeps totals consistent', () => {
    expect(loan.totalInterest).toBe(sumRwf(loan.rows.map((r) => r.interest)));
    expect(loan.totalPayable).toBe(sumRwf(loan.rows.map((r) => r.payment)));
    expect(loan.totalPayable).toBe(4_500_000n + loan.totalInterest);
  });

  it('holds its invariants for many loan shapes', () => {
    let seed = 42;
    const rand = () => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 400; i++) {
      const principal = BigInt(1 + Math.floor(rand() * 50_000_000));
      const bps = Math.floor(rand() * 6000);
      const term = 1 + Math.floor(rand() * 60);
      const s = buildSchedule({
        principal,
        annualRateBps: bps,
        termMonths: term,
        firstDueDate: '2026-01-31',
      });
      const label = `${principal} @ ${bps}bps x ${term}`;
      expect(s.rows.at(-1)!.balanceAfter, label).toBe(0n);
      expect(sumRwf(s.rows.map((r) => r.principal)), label).toBe(principal);
      let balance = principal;
      for (const row of s.rows) {
        expect(row.principal >= 0n && row.interest >= 0n, label).toBe(true);
        expect(row.payment, label).toBe(row.principal + row.interest);
        expect(row.interest, label).toBe(monthlyInterest(balance, bps));
        balance -= row.principal;
        expect(row.balanceAfter, label).toBe(balance);
      }
    }
  });

  it('clamps due dates to the end of short months', () => {
    const s = buildSchedule({
      principal: 1_000_000n,
      annualRateBps: 1200,
      termMonths: 4,
      firstDueDate: '2027-01-31',
    });
    expect(s.rows.map((r) => r.dueDate)).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
  });

  it('handles a single instalment', () => {
    const s = buildSchedule({
      principal: 600_000n,
      annualRateBps: 1200,
      termMonths: 1,
      firstDueDate: '2026-12-01',
    });
    expect(s.rows).toEqual([
      {
        number: 1,
        dueDate: '2026-12-01',
        principal: 600_000n,
        interest: 6_000n,
        payment: 606_000n,
        balanceAfter: 0n,
      },
    ]);
  });
});

describe('restructure quotes', () => {
  // LN-0418-2026 after 6 of 18 instalments, as in the restructure dialog.
  const loan = buildSchedule({
    principal: 4_500_000n,
    annualRateBps: 1700,
    termMonths: 18,
    firstDueDate: '2026-06-04',
  });
  const outstanding = loan.rows[5]!.balanceAfter;
  const input = {
    outstandingPrincipal: outstanding,
    annualRateBps: 1700,
    currentInstalment: loan.instalment,
    remainingMonths: 12,
  };

  it('extending the term lowers the instalment and costs more interest', () => {
    const q = quoteExtendTerm(input, 18);
    const expected = BigInt(Math.round(floatInstalment(Number(outstanding), 0.17, 18)));
    expect(q.newInstalment).toBe(expected);
    expect(q.instalmentChange < 0n).toBe(true);
    expect(q.extraInterest > 0n).toBe(true);
    expect(q.newPrincipal).toBe(outstanding);
  });

  it('refuses an extension that is not longer', () => {
    expect(() => quoteExtendTerm(input, 12)).toThrow(RangeError);
  });

  it('a payment holiday capitalises one month of interest', () => {
    const q = quotePaymentHoliday(input);
    expect(q.capitalisedInterest).toBe(monthlyInterest(outstanding, 1700));
    expect(q.newPrincipal).toBe(outstanding + q.capitalisedInterest);
    expect(q.newTermMonths).toBe(12);
    expect(q.newInstalment > loan.instalment).toBe(true);
  });
});
