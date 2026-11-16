/** Shared domain vocabulary. Values match the Prisma enums in apps/api. */

export const STAFF_ROLES = [
  'ADMIN',
  'MANAGER',
  'LOAN_OFFICER',
  'CREDIT_ANALYST',
  'COLLECTIONS_AGENT',
  'ACCOUNTANT',
  'AUDITOR',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  LOAN_OFFICER: 'Loan officer',
  CREDIT_ANALYST: 'Credit analyst',
  COLLECTIONS_AGENT: 'Collections agent',
  ACCOUNTANT: 'Accountant',
  AUDITOR: 'Auditor',
};

/** What each role is for, shown when an administrator assigns roles. */
export const STAFF_ROLE_DESCRIPTIONS: Record<StaffRole, string> = {
  ADMIN: 'Company settings, staff, products, and everything a manager can do.',
  MANAGER: 'Approves and disburses loans, decides restructures and write-offs.',
  LOAN_OFFICER: 'Registers borrowers, takes applications and manages their own book.',
  CREDIT_ANALYST: 'Assesses applications, cash flow and security; recommends decisions.',
  COLLECTIONS_AGENT: 'Works overdue accounts: contacts, promises to pay and payments.',
  ACCOUNTANT:
    'Records expenses and journals, reconciles, runs financial statements and closes periods.',
  AUDITOR: 'Read-only access to loans, accounts, reports and the audit log.',
};

/** Roles that work applications (create, move, score, assess). */
export const LENDING_ROLES = [
  'LOAN_OFFICER',
  'CREDIT_ANALYST',
  'MANAGER',
  'ADMIN',
] as const satisfies readonly StaffRole[];

/** Roles that may record a repayment received outside MoMo. */
export const PAYMENT_ROLES = [
  'LOAN_OFFICER',
  'COLLECTIONS_AGENT',
  'ACCOUNTANT',
  'MANAGER',
  'ADMIN',
] as const satisfies readonly StaffRole[];

/** Roles that work in the accounting module. */
export const FINANCE_ROLES = [
  'ACCOUNTANT',
  'MANAGER',
  'ADMIN',
] as const satisfies readonly StaffRole[];

/** Roles that can read management reports and the books. */
export const OVERSIGHT_ROLES = [
  'MANAGER',
  'ADMIN',
  'ACCOUNTANT',
  'AUDITOR',
] as const satisfies readonly StaffRole[];

/** Auditors can look at everything and change nothing. */
export const READ_ONLY_ROLES = ['AUDITOR'] as const satisfies readonly StaffRole[];

export const APPLICATION_STAGES = [
  'NEW',
  'UNDER_REVIEW',
  'CREDIT_CHECK',
  'APPROVED',
  'DISBURSED',
  'DECLINED',
  'WITHDRAWN',
] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

/** The five columns of the pipeline board, in order. */
export const PIPELINE_STAGES = [
  'NEW',
  'UNDER_REVIEW',
  'CREDIT_CHECK',
  'APPROVED',
  'DISBURSED',
] as const satisfies readonly ApplicationStage[];

export const APPLICATION_STAGE_LABELS: Record<ApplicationStage, string> = {
  NEW: 'New',
  UNDER_REVIEW: 'Under review',
  CREDIT_CHECK: 'Credit check',
  APPROVED: 'Approved',
  DISBURSED: 'Disbursed',
  DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn',
};

const STAGE_TRANSITIONS: Record<ApplicationStage, readonly ApplicationStage[]> = {
  NEW: ['UNDER_REVIEW', 'DECLINED', 'WITHDRAWN'],
  UNDER_REVIEW: ['CREDIT_CHECK', 'APPROVED', 'DECLINED', 'WITHDRAWN'],
  CREDIT_CHECK: ['APPROVED', 'UNDER_REVIEW', 'DECLINED', 'WITHDRAWN'],
  APPROVED: ['DISBURSED', 'WITHDRAWN'],
  DISBURSED: [],
  DECLINED: [],
  WITHDRAWN: [],
};

export function canMoveStage(from: ApplicationStage, to: ApplicationStage): boolean {
  return STAGE_TRANSITIONS[from].includes(to);
}

export const PAYMENT_CHANNELS = ['MTN_MOMO', 'AIRTEL_MONEY', 'BANK_TRANSFER', 'CASH'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export const PAYMENT_CHANNEL_LABELS: Record<PaymentChannel, string> = {
  MTN_MOMO: 'MTN MoMo',
  AIRTEL_MONEY: 'Airtel Money',
  BANK_TRANSFER: 'Bank transfer',
  CASH: 'Cash at branch',
};

/** Credit scores run 300–850, as on the borrower profile. */
export const SCORE_MIN = 300;
export const SCORE_MAX = 850;

export type ScoreBand = 'strong' | 'fair' | 'weak';

/** Bands used for the score bar colour in the pipeline (700+, 640+, below). */
export function scoreBand(score: number): ScoreBand {
  if (score >= 700) return 'strong';
  if (score >= 640) return 'fair';
  return 'weak';
}

/** Position of a score on the 300–850 bar, 0–100. */
export function scorePercent(score: number): number {
  const clamped = Math.min(SCORE_MAX, Math.max(SCORE_MIN, score));
  return Math.round(((clamped - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * 100);
}

export type ScoreLabel = 'Excellent' | 'Good' | 'Fair' | 'Needs review';

/** The word shown next to a score, e.g. "742 · Good". */
export function scoreLabel(score: number): ScoreLabel {
  if (score >= 760) return 'Excellent';
  if (score >= 700) return 'Good';
  if (score >= 640) return 'Fair';
  return 'Needs review';
}

/** "Kevin Nkurunziza" is shown as "Kevin N." across the console. */
export function shortStaffName(firstName: string, lastName: string): string {
  return lastName ? `${firstName} ${lastName.charAt(0)}.` : firstName;
}

export const PRODUCT_KINDS = ['SME', 'PERSONAL', 'AGRI', 'ASSET'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const PRODUCT_KIND_LABELS: Record<ProductKind, string> = {
  SME: 'SME',
  PERSONAL: 'Personal',
  AGRI: 'Agri',
  ASSET: 'Asset finance',
};
