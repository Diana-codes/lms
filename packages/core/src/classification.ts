import { provisionBase } from './collateral';
import { applyBps, ratioBps, type Rwf } from './money';

/**
 * BNR Regulation Nº 59/2023 — credit classification categories
 * (Arts. 4–12) and minimum provision rates (Arts. 14–15).
 */
export const CREDIT_CLASSES = [
  'NORMAL',
  'WATCH',
  'SUBSTANDARD',
  'DOUBTFUL',
  'LOSS',
] as const;
export type CreditClass = (typeof CREDIT_CLASSES)[number];

export const CREDIT_CLASS_LABELS: Record<CreditClass, string> = {
  NORMAL: 'Normal',
  WATCH: 'Watch',
  SUBSTANDARD: 'Substandard',
  DOUBTFUL: 'Doubtful',
  LOSS: 'Loss',
};

/**
 * Which DPD schedule to use. Deposit-taking microfinance *companies*
 * and *cooperatives* have different day bands under 59/2023.
 */
export const CREDIT_CLASS_PROFILES = ['COMPANY', 'COOPERATIVE'] as const;
export type CreditClassProfile = (typeof CREDIT_CLASS_PROFILES)[number];

/** Inclusive lower bound of DPD for each class, by institution type. */
export const CREDIT_CLASS_DPD: Record<
  CreditClassProfile,
  Record<CreditClass, number>
> = {
  // Art. 5–12 objective criteria for deposit-taking microfinance companies.
  COMPANY: {
    NORMAL: 0,
    WATCH: 30,
    SUBSTANDARD: 90,
    DOUBTFUL: 180,
    LOSS: 365,
  },
  // Same articles, cooperative schedule (stricter).
  COOPERATIVE: {
    NORMAL: 0,
    WATCH: 1,
    SUBSTANDARD: 30,
    DOUBTFUL: 90,
    LOSS: 180,
  },
};

/**
 * Minimum provision as a share of outstanding principal, in basis points.
 * Normal/Watch = general (Art. 14); Substandard/Doubtful/Loss = specific (Art. 15).
 */
export const PROVISION_BPS: Record<CreditClass, number> = {
  NORMAL: 100, // 1%
  WATCH: 500, // 5%
  SUBSTANDARD: 2500, // 25%
  DOUBTFUL: 5000, // 50%
  LOSS: 10_000, // 100%
};

export function isNonPerforming(creditClass: CreditClass): boolean {
  return (
    creditClass === 'SUBSTANDARD' ||
    creditClass === 'DOUBTFUL' ||
    creditClass === 'LOSS'
  );
}

/** Objective classification from days past due (Arts. 5–12). */
export function classifyByDpd(
  dpd: number,
  profile: CreditClassProfile = 'COMPANY',
): CreditClass {
  const bands = CREDIT_CLASS_DPD[profile];
  if (dpd >= bands.LOSS) return 'LOSS';
  if (dpd >= bands.DOUBTFUL) return 'DOUBTFUL';
  if (dpd >= bands.SUBSTANDARD) return 'SUBSTANDARD';
  if (dpd >= bands.WATCH) return 'WATCH';
  return 'NORMAL';
}

/**
 * Required provision for one facility (Arts. 14–15). For Watch and worse,
 * `admissibleCollateral` is deducted first (Art. 19).
 */
export function requiredProvision(
  outstandingPrincipal: Rwf,
  creditClass: CreditClass,
  admissibleCollateral: Rwf = 0n,
): Rwf {
  const base = provisionBase(outstandingPrincipal, creditClass, admissibleCollateral);
  if (base <= 0n) return 0n;
  return applyBps(base, PROVISION_BPS[creditClass]);
}

export interface ClassifiedLoan {
  outstandingPrincipal: Rwf;
  dpd: number;
  creditClass: CreditClass;
  admissibleCollateral: Rwf;
  provisionBase: Rwf;
  requiredProvision: Rwf;
  nonPerforming: boolean;
}

export function classifyLoan(
  outstandingPrincipal: Rwf,
  dpd: number,
  profile: CreditClassProfile = 'COMPANY',
  admissibleCollateral: Rwf = 0n,
): ClassifiedLoan {
  const creditClass = classifyByDpd(dpd, profile);
  const base = provisionBase(outstandingPrincipal, creditClass, admissibleCollateral);
  return {
    outstandingPrincipal,
    dpd,
    creditClass,
    admissibleCollateral,
    provisionBase: base,
    requiredProvision: requiredProvision(outstandingPrincipal, creditClass, admissibleCollateral),
    nonPerforming: isNonPerforming(creditClass),
  };
}

export interface ClassificationBucket {
  creditClass: CreditClass;
  label: string;
  loanCount: number;
  outstandingPrincipal: Rwf;
  requiredProvision: Rwf;
  provisionBps: number;
  nonPerforming: boolean;
}

export interface PortfolioClassification {
  profile: CreditClassProfile;
  loans: number;
  outstandingPrincipal: Rwf;
  requiredProvision: Rwf;
  nonPerformingPrincipal: Rwf;
  nplBps: number;
  buckets: ClassificationBucket[];
}

/** Aggregate a portfolio into the five BNR classes for a regulatory report. */
export function classifyPortfolio(
  loans: Iterable<{
    outstandingPrincipal: Rwf;
    dpd: number;
    admissibleCollateral?: Rwf;
  }>,
  profile: CreditClassProfile = 'COMPANY',
): PortfolioClassification {
  const byClass = new Map<CreditClass, { count: number; principal: Rwf; provision: Rwf }>();
  for (const c of CREDIT_CLASSES) {
    byClass.set(c, { count: 0, principal: 0n, provision: 0n });
  }
  let outstanding = 0n;
  let required = 0n;
  let npl = 0n;
  let loansCount = 0;
  for (const loan of loans) {
    if (loan.outstandingPrincipal <= 0n) continue;
    loansCount += 1;
    const row = classifyLoan(
      loan.outstandingPrincipal,
      loan.dpd,
      profile,
      loan.admissibleCollateral ?? 0n,
    );
    outstanding += row.outstandingPrincipal;
    required += row.requiredProvision;
    if (row.nonPerforming) npl += row.outstandingPrincipal;
    const bucket = byClass.get(row.creditClass)!;
    bucket.count += 1;
    bucket.principal += row.outstandingPrincipal;
    bucket.provision += row.requiredProvision;
  }
  return {
    profile,
    loans: loansCount,
    outstandingPrincipal: outstanding,
    requiredProvision: required,
    nonPerformingPrincipal: npl,
    nplBps: ratioBps(npl, outstanding),
    buckets: CREDIT_CLASSES.map((creditClass) => {
      const b = byClass.get(creditClass)!;
      return {
        creditClass,
        label: CREDIT_CLASS_LABELS[creditClass],
        loanCount: b.count,
        outstandingPrincipal: b.principal,
        requiredProvision: b.provision,
        provisionBps: PROVISION_BPS[creditClass],
        nonPerforming: isNonPerforming(creditClass),
      };
    }),
  };
}
