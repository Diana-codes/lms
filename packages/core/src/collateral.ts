import { applyBps, type Rwf } from './money';

/**
 * Admissible collateral kinds under BNR Regulation 59/2023 Art. 19(3).
 * `OTHER` is tracked for the loan file but does not reduce provisions.
 */
export const COLLATERAL_KINDS = [
  'CASH',
  'GOVT_SECURITIES',
  'BANK_SECURITIES',
  'RESIDENTIAL_MORTGAGE',
  'COMMERCIAL_MORTGAGE',
  'LAND',
  'MOVABLE',
  'OTHER',
] as const;
export type CollateralKind = (typeof COLLATERAL_KINDS)[number];

export const COLLATERAL_KIND_LABELS: Record<CollateralKind, string> = {
  CASH: 'Cash collateral',
  GOVT_SECURITIES: 'Government / BNR securities',
  BANK_SECURITIES: 'Bank securities (Rwanda)',
  RESIDENTIAL_MORTGAGE: 'Residential mortgage',
  COMMERCIAL_MORTGAGE: 'Commercial mortgage',
  LAND: 'Land',
  MOVABLE: 'Movable assets',
  OTHER: 'Other security',
};

/**
 * Maximum share of market value deductible when provisioning (Art. 19(3)),
 * in basis points. Zero means not admissible for provisioning.
 */
export const COLLATERAL_HAIRCUT_BPS: Record<CollateralKind, number> = {
  CASH: 10_000,
  GOVT_SECURITIES: 10_000,
  BANK_SECURITIES: 10_000,
  RESIDENTIAL_MORTGAGE: 7000,
  COMMERCIAL_MORTGAGE: 5000,
  LAND: 3000,
  MOVABLE: 3000,
  OTHER: 0,
};

export interface CollateralItem {
  kind: CollateralKind;
  marketValue: Rwf;
  /** Required for mortgages and land to count toward provisioning. */
  registered?: boolean;
  /** Required for movable assets to count toward provisioning. */
  insured?: boolean;
}

/** Whether this item meets Art. 20 documentation rules for its kind. */
export function collateralIsAdmissible(item: CollateralItem): boolean {
  if (COLLATERAL_HAIRCUT_BPS[item.kind] === 0) return false;
  if (
    item.kind === 'RESIDENTIAL_MORTGAGE' ||
    item.kind === 'COMMERCIAL_MORTGAGE' ||
    item.kind === 'LAND'
  ) {
    return item.registered === true;
  }
  if (item.kind === 'MOVABLE') return item.insured === true;
  return true;
}

/** Deductible value of one item after the Art. 19(3) haircut. */
export function admissibleValueOf(item: CollateralItem): Rwf {
  if (item.marketValue <= 0n || !collateralIsAdmissible(item)) return 0n;
  return applyBps(item.marketValue, COLLATERAL_HAIRCUT_BPS[item.kind]);
}

/** Sum of deductible collateral for a loan. */
export function totalAdmissibleCollateral(items: Iterable<CollateralItem>): Rwf {
  let total = 0n;
  for (const item of items) total += admissibleValueOf(item);
  return total;
}

/**
 * Principal base for provisioning (Art. 19(1)): for Watch and worse,
 * deduct admissible collateral before applying the provision rate.
 * Normal stays on the full outstanding.
 */
export function provisionBase(
  outstandingPrincipal: Rwf,
  creditClass: string,
  admissibleCollateral: Rwf = 0n,
): Rwf {
  if (outstandingPrincipal <= 0n) return 0n;
  if (creditClass === 'NORMAL') return outstandingPrincipal;
  const net = outstandingPrincipal - admissibleCollateral;
  return net > 0n ? net : 0n;
}
