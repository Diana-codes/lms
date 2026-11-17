import { describe, expect, it } from 'vitest';
import {
  costOfCredit,
  originationFee,
  penaltyAmount,
  penaltyChargeDate,
  penaltyChargesDue,
} from './charges';

describe('origination fee', () => {
  it('is a share of the principal, rounded to the franc', () => {
    expect(originationFee(4_500_000n, 150)).toBe(67_500n);
    expect(originationFee(333_333n, 150)).toBe(5_000n);
    expect(originationFee(1_000_000n, 0)).toBe(0n);
  });
});

describe('late penalties', () => {
  const due = '2026-11-04';
  it('wait out the 5-day grace period', () => {
    expect(penaltyChargesDue(due, '2026-11-04')).toBe(0);
    expect(penaltyChargesDue(due, '2026-11-09')).toBe(0); // 5 days late
    expect(penaltyChargesDue(due, '2026-11-10')).toBe(1); // 6 days late
  });
  it('charge again every 30 days the instalment stays unpaid', () => {
    expect(penaltyChargesDue(due, '2026-12-09')).toBe(1); // 35 days
    expect(penaltyChargesDue(due, '2026-12-10')).toBe(2); // 36 days
    expect(penaltyChargesDue(due, '2027-01-09')).toBe(3);
  });
  it('fall on predictable dates', () => {
    expect(penaltyChargeDate(due, 1)).toBe('2026-11-10');
    expect(penaltyChargeDate(due, 2)).toBe('2026-12-10');
    for (let n = 1; n <= 4; n++) expect(penaltyChargesDue(due, penaltyChargeDate(due, n))).toBe(n);
  });
  it('follow a product with a different grace period', () => {
    expect(penaltyChargesDue(due, '2026-11-05', 0)).toBe(1);
    expect(penaltyChargesDue(due, '2026-11-14', 10)).toBe(0);
  });
  it('are 2% of what is overdue, and nothing when nothing is', () => {
    expect(penaltyAmount(284_985n, 200)).toBe(5_700n);
    expect(penaltyAmount(0n, 200)).toBe(0n);
  });
});

describe('cost of credit', () => {
  it('gives the Key Facts for the design loan', () => {
    const c = costOfCredit({
      principal: 4_500_000n,
      annualRateBps: 1700,
      termMonths: 18,
      feeBps: 150,
    });
    expect(c).toMatchObject({
      fee: 67_500n,
      netDisbursed: 4_432_500n,
      instalment: 284_985n,
      totalInterest: 629_738n,
      totalRepayable: 5_129_738n,
      totalCost: 697_238n,
    });
    // The fee lifts the true yearly cost above the 17% interest rate.
    expect(c.aprBps).toBeGreaterThan(1700);
    // Checked independently: monthly IRR × 12 = 19.02%.
    expect(c.aprBps).toBe(1902);
  });
  it('equals the interest rate when there is no fee', () => {
    for (const [rate, term] of [
      [1700, 18],
      [1200, 3],
      [2000, 24],
    ] as const) {
      const c = costOfCredit({
        principal: 1_000_000n,
        annualRateBps: rate,
        termMonths: term,
        feeBps: 0,
      });
      expect(Math.abs(c.aprBps - rate), `${rate} over ${term}`).toBeLessThanOrEqual(1);
      expect(c.totalCost).toBe(c.totalInterest);
    }
  });
  it('weighs a fee more heavily on a short loan', () => {
    const short = costOfCredit({
      principal: 1_000_000n,
      annualRateBps: 1200,
      termMonths: 3,
      feeBps: 150,
    });
    const long = costOfCredit({
      principal: 1_000_000n,
      annualRateBps: 1200,
      termMonths: 24,
      feeBps: 150,
    });
    expect(short.aprBps).toBeGreaterThan(long.aprBps);
  });
});
