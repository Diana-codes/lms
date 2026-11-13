/** Shared domain vocabulary. Values match the Prisma enums in apps/api. */

export const STAFF_ROLES = ['ADMIN', 'MANAGER', 'LOAN_OFFICER', 'COLLECTIONS_AGENT'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  LOAN_OFFICER: 'Loan officer',
  COLLECTIONS_AGENT: 'Collections agent',
};

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
