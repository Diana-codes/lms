import { describe, expect, it } from 'vitest';
import { checkAffordability, collectionRateBps, daysPastDue, dpdBucket, par30Bps } from './risk';

describe('days past due', () => {
  it('counts days since the oldest unpaid due date', () => {
    expect(daysPastDue('2026-07-31', '2026-11-12')).toBe(104);
    expect(daysPastDue('2026-11-07', '2026-11-12')).toBe(5);
  });
  it('is zero when nothing is overdue', () => {
    expect(daysPastDue(null, '2026-11-12')).toBe(0);
    expect(daysPastDue('2026-11-12', '2026-11-12')).toBe(0);
    expect(daysPastDue('2026-12-04', '2026-11-12')).toBe(0);
  });
  it('buckets at the documented edges', () => {
    expect(dpdBucket(0)).toBe('CURRENT');
    expect(dpdBucket(1)).toBe('DPD_1_30');
    expect(dpdBucket(30)).toBe('DPD_1_30');
    expect(dpdBucket(31)).toBe('DPD_31_90');
    expect(dpdBucket(90)).toBe('DPD_31_90');
    expect(dpdBucket(91)).toBe('DPD_90_PLUS');
  });
});

describe('portfolio ratios', () => {
  it('PAR 30 counts only loans more than 30 days late', () => {
    const loans = [
      { outstandingPrincipal: 900_000n, dpd: 0 },
      { outstandingPrincipal: 50_000n, dpd: 30 },
      { outstandingPrincipal: 30_000n, dpd: 31 },
      { outstandingPrincipal: 20_000n, dpd: 104 },
    ];
    expect(par30Bps(loans)).toBe(500);
    expect(par30Bps([])).toBe(0);
  });
  it('collection rate is collected over due', () => {
    expect(collectionRateBps(964n, 1000n)).toBe(9640);
    expect(collectionRateBps(0n, 0n)).toBe(0);
  });
});

describe('affordability', () => {
  it('allows instalments up to 35% of income by default', () => {
    // Aline: RWF 1,650,000 a month, instalment RWF 284,985
    const r = checkAffordability({ monthlyIncome: 1_650_000n, newInstalment: 284_985n });
    expect(r.affordable).toBe(true);
    expect(r.maxInstalment).toBe(577_500n);
    expect(r.ratioBps).toBe(1727);
  });
  it('counts existing instalments and respects the exact limit', () => {
    expect(
      checkAffordability({ monthlyIncome: 1_000_000n, newInstalment: 350_000n }).affordable,
    ).toBe(true);
    expect(
      checkAffordability({ monthlyIncome: 1_000_000n, newInstalment: 350_001n }).affordable,
    ).toBe(false);
    expect(
      checkAffordability({
        monthlyIncome: 1_000_000n,
        newInstalment: 200_000n,
        existingInstalments: 200_000n,
      }).affordable,
    ).toBe(false);
  });
  it('takes a per-product limit and never passes zero income', () => {
    expect(
      checkAffordability({ monthlyIncome: 1_000_000n, newInstalment: 400_000n, limitBps: 4000 })
        .affordable,
    ).toBe(true);
    expect(checkAffordability({ monthlyIncome: 0n, newInstalment: 0n }).affordable).toBe(false);
  });
});
