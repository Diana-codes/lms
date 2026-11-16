import { describe, expect, it } from 'vitest';
import {
  admissibleValueOf,
  collateralIsAdmissible,
  COLLATERAL_HAIRCUT_BPS,
  provisionBase,
  totalAdmissibleCollateral,
} from './collateral';

describe('BNR 59/2023 collateral haircuts', () => {
  it('applies the Art. 19(3) rates', () => {
    expect(COLLATERAL_HAIRCUT_BPS.CASH).toBe(10_000);
    expect(COLLATERAL_HAIRCUT_BPS.RESIDENTIAL_MORTGAGE).toBe(7000);
    expect(COLLATERAL_HAIRCUT_BPS.COMMERCIAL_MORTGAGE).toBe(5000);
    expect(COLLATERAL_HAIRCUT_BPS.LAND).toBe(3000);
    expect(COLLATERAL_HAIRCUT_BPS.MOVABLE).toBe(3000);
    expect(COLLATERAL_HAIRCUT_BPS.OTHER).toBe(0);
  });

  it('requires registration for mortgages and land, insurance for movables', () => {
    expect(
      collateralIsAdmissible({
        kind: 'RESIDENTIAL_MORTGAGE',
        marketValue: 10_000_000n,
        registered: false,
      }),
    ).toBe(false);
    expect(
      collateralIsAdmissible({
        kind: 'RESIDENTIAL_MORTGAGE',
        marketValue: 10_000_000n,
        registered: true,
      }),
    ).toBe(true);
    expect(
      collateralIsAdmissible({ kind: 'MOVABLE', marketValue: 1_000_000n, insured: false }),
    ).toBe(false);
    expect(
      collateralIsAdmissible({ kind: 'MOVABLE', marketValue: 1_000_000n, insured: true }),
    ).toBe(true);
    expect(collateralIsAdmissible({ kind: 'CASH', marketValue: 500_000n })).toBe(true);
    expect(collateralIsAdmissible({ kind: 'OTHER', marketValue: 500_000n })).toBe(false);
  });

  it('haircuts market value to the deductible amount', () => {
    expect(
      admissibleValueOf({
        kind: 'RESIDENTIAL_MORTGAGE',
        marketValue: 10_000_000n,
        registered: true,
      }),
    ).toBe(7_000_000n);
    expect(admissibleValueOf({ kind: 'CASH', marketValue: 200_000n })).toBe(200_000n);
    expect(admissibleValueOf({ kind: 'OTHER', marketValue: 200_000n })).toBe(0n);
  });

  it('sums deductible collateral and nets it from Watch+ provision bases', () => {
    const items = [
      { kind: 'CASH' as const, marketValue: 100_000n },
      {
        kind: 'MOVABLE' as const,
        marketValue: 1_000_000n,
        insured: true,
      },
    ];
    expect(totalAdmissibleCollateral(items)).toBe(100_000n + 300_000n);
    expect(provisionBase(1_000_000n, 'NORMAL', 400_000n)).toBe(1_000_000n);
    expect(provisionBase(1_000_000n, 'WATCH', 400_000n)).toBe(600_000n);
    expect(provisionBase(1_000_000n, 'LOSS', 2_000_000n)).toBe(0n);
  });
});
