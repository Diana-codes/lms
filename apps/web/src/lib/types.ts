import type {
  ApplicationStage,
  DpdBucket,
  InstalmentState,
  LoanTerms,
  PaymentTiming,
  ProductKind,
  StaffRole,
} from '@kora/core';

export interface Me {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: StaffRole;
  branchId: string | null;
  /** Required: until it is set up, the console only offers the setup page. */
  twoFactorEnabled: boolean;
  twoFactorMethod: TwoFactorMethod | null;
  /** The confirmed number for texted codes, masked. */
  verifiedPhone: string | null;
  /** An administrator set the password; the console asks for a new one first. */
  mustChangePassword: boolean;
}

/** GET /users. */
export interface StaffMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: StaffRole;
  branchId: string | null;
  branch: string | null;
  phone: string | null;
  isActive: boolean;
  twoFactorEnabled: boolean;
  twoFactorMethod: TwoFactorMethod | null;
  mustChangePassword: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
}

/** GET /company/settings: what a company's administrators see and can change. */
export interface CompanySettings {
  slug: string;
  name: string;
  legalName: string | null;
  country: string;
  currency: string;
  timezone: string;
  defaultLanguage: 'EN' | 'RW' | 'FR';
  brandName: string | null;
  brandColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  features: { ai: boolean; autoApprove: boolean };
  /** Which provider settings are set, by key. Never their values. */
  secrets: Record<string, boolean>;
  webhookConfigured: boolean;
}

export type ProductStatus = 'DRAFT' | 'PUBLISHED' | 'RETIRED';

/** GET /products/manage. */
export interface ProductSummary {
  code: string;
  name: string;
  shortName: string;
  kind: ProductKind;
  status: ProductStatus;
  version: number;
  annualRateBps: number;
  terms: LoanTerms;
  minAmount: string;
  maxAmount: string;
  minTermMonths: number;
  maxTermMonths: number;
  activeLoans: number;
  updatedAt: string;
}

/** GET /products/:code. */
export interface ProductDetail {
  code: string;
  name: string;
  shortName: string;
  description: string | null;
  kind: ProductKind;
  status: ProductStatus;
  version: number;
  terms: LoanTerms;
  minAmount: string;
  maxAmount: string;
  minTermMonths: number;
  maxTermMonths: number;
  affordabilityBps: number;
  autoApproveMinScore: number | null;
  autoApproveMaxAmount: string | null;
  secondApprovalAbove: string | null;
  loans: number;
  applications: number;
  versions: Array<{ version: number; createdAt: string }>;
}

/** POST /products/quote. Money as digit strings. */
export interface QuoteResult {
  amount: string;
  principal: string;
  netDisbursed: string;
  instalment: string;
  instalmentCount: number;
  totalInterest: string;
  totalFees: string;
  totalThirdParty: string;
  totalVat: string;
  totalCostOfCredit: string;
  totalRepayable: string;
  aprBps: number;
  effectiveAnnualBps: number;
  fees: Array<{
    code: string;
    name: string;
    timing: string;
    thirdParty: boolean;
    amount: string;
    vat: string;
  }>;
  rows: Array<{
    number: number;
    dueDate: string;
    principal: string;
    interest: string;
    fee: string;
    payment: string;
    balanceAfter: string;
  }>;
}

/** GET /branches. */
export interface Branch {
  id: string;
  code: string;
  name: string;
  district: string;
}

/** GET /system/stats. Money arrives as digit strings (see @kora/core parseRwf). */
export interface SystemStats {
  asOf: string;
  counts: {
    staff: number;
    borrowers: number;
    applications: number;
    products: number;
    loans: Record<string, number>;
  };
  portfolio: {
    activeLoans: number;
    outstandingPrincipal: string;
    par30Bps: number;
    dpdBuckets: Record<DpdBucket, number>;
  };
  ledger: { entries: string; totalDebits: string; totalCredits: string; balanced: boolean };
}

/** How someone proves it is them after their password. */
export type TwoFactorMethod = 'app' | 'sms';

/** The second sign-in step: which code to ask for, and where a texted one went. */
export interface TwoFactorChallenge {
  status: 'TWO_FACTOR_REQUIRED';
  method: TwoFactorMethod;
  challengeToken: string;
  sentTo?: string;
}

export type LoginResponse = { status: 'OK'; user: Me } | TwoFactorChallenge;

// ── Phase 1: lending ────────────────────────────────────────────────────
// Shapes returned by the API. Money is always a string of digits.

export type PillToneName = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

export interface Overview {
  asOf: string;
  scope: 'mine' | 'all';
  metrics: {
    activePortfolio: string;
    portfolioChangeBps: number | null;
    activeLoans: number;
    disbursedThisMonth: string;
    loansThisMonth: number;
    loansVsLastMonth: number;
    lastMonthLabel: string;
    collectionRateBps: number | null;
    par30Bps: number;
    loansOver30: number;
  };
  series: Array<{ month: string; label: string; disbursed: string; collected: string }>;
  buckets: Record<DpdBucket, number>;
  recentApplications: Array<{
    code: string;
    name: string;
    initials: string;
    productName: string;
    amount: string;
    score: number | null;
    status: string;
  }>;
  dueThisWeek: {
    total: number;
    items: Array<{
      loanCode: string;
      name: string;
      weekday: string;
      day: number;
      note: string;
      amount: string;
    }>;
  };
}

export interface NotificationList {
  unread: number;
  items: Array<{
    id: string;
    kind: 'AI_FLAG' | 'RISK' | 'CONTRACT' | 'PAYMENT' | 'SYSTEM';
    title: string;
    href: string | null;
    read: boolean;
    createdAt: string;
  }>;
}

export interface SearchResults {
  borrowers: Array<{ code: string; name: string }>;
  loans: Array<{ code: string; name: string }>;
}

export interface ApplicationCard {
  code: string;
  stage: ApplicationStage;
  stageLabel: string;
  stageEnteredAt: string;
  statusNote: string | null;
  borrowerName: string;
  borrowerCode: string;
  productCode: string;
  productName: string;
  productShortName: string;
  kind: ProductKind;
  amount: string;
  termMonths: number;
  annualRateBps: number;
  instalment: string;
  frequency: LoanTerms['frequency'];
  instalmentCount: number;
  /** Paid to the borrower after fees taken at disbursement. */
  netDisbursed: string;
  totalFees: string;
  aprBps: number;
  score: number | null;
  ai: {
    tone: 'ok' | 'warn' | 'flag';
    recommendation: string | null;
    title: string;
    why: string;
    modelVersion: string;
  } | null;
  officerId: string | null;
  officerInitials: string | null;
  officerName: string | null;
  docsReceived: number;
  docsRequired: number;
  needsSecondApproval: boolean;
  autoEligible: boolean;
  firstApprovalBy: { id: string; name: string } | null;
  declineReason: string | null;
  loanCode: string | null;
  disbursement: {
    id: string;
    status: 'PENDING' | 'SENT' | 'SUCCESSFUL' | 'FAILED';
    reason: string | null;
  } | null;
  submittedAt: string;
}

export interface Pipeline {
  columns: Array<{ stage: ApplicationStage; label: string; cards: ApplicationCard[] }>;
}

export interface Product {
  code: string;
  name: string;
  shortName: string;
  kind: ProductKind;
  annualRateBps: number;
  minTermMonths: number;
  maxTermMonths: number;
  minAmount: string;
  maxAmount: string;
}

export interface Paged<T> {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  items: T[];
}

export interface LoanListItem {
  code: string;
  status: 'PENDING_DISBURSEMENT' | 'ACTIVE' | 'REPAID' | 'WRITTEN_OFF';
  borrowerName: string;
  borrowerCode: string;
  productName: string;
  principal: string;
  outstanding: string;
  instalment: string;
  disbursedOn: string | null;
  nextDue: string | null;
  dpd: number;
  bucket: DpdBucket | null;
  officerName: string | null;
}

export type LoanList = Paged<LoanListItem> & { outstanding: string };

export interface ScheduleRow {
  number: number;
  dueDate: string;
  principal: string;
  interest: string;
  /** Fees collected with the instalment, VAT included. */
  fee: string;
  /** Late charges on it so far. */
  penalty: string;
  payment: string;
  paid: string;
  remaining: string;
  balanceAfter: string;
  state: InstalmentState;
  paidAt: string | null;
}

export interface LoanDetail {
  code: string;
  status: LoanListItem['status'];
  statusLabel: string;
  dpd: number;
  asOf: string;
  borrower: {
    code: string;
    name: string;
    initials: string;
    phone: string;
    kycStatus: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';
    score: { value: number; label: string } | null;
    previousLoans: number;
    previousLoansRepaid: number;
    businessName: string | null;
    sector: string | null;
  };
  productName: string;
  officerName: string | null;
  terms: {
    principal: string;
    annualRateBps: number;
    termMonths: number;
    instalment: string;
    disbursedOn: string | null;
    maturityDate: string;
    channel: string | null;
    collateral: string | null;
    interestMethod: LoanTerms['interestMethod'];
    frequency: LoanTerms['frequency'];
    rateBps: number;
    ratePeriod: LoanTerms['ratePeriod'];
    /** Null for loans issued before products had terms. */
    aprBps: number | null;
    netDisbursed: string | null;
    productVersion: number | null;
    fees: Array<{
      name: string;
      basis: 'PERCENT' | 'FIXED';
      value: number;
      timing: string;
      vat: boolean;
      thirdParty: boolean;
    }>;
    penalty: LoanTerms['penalty'];
    overpayment: LoanTerms['overpayment'];
    payoffInterest: LoanTerms['payoff']['interest'];
  };
  figures: {
    outstandingPrincipal: string;
    totalRepaid: string;
    totalRemaining: string;
    /** What closes the loan today, under its payoff rule. Null unless active. */
    payoff: {
      total: string;
      principal: string;
      interest: string;
      fees: string;
      penalties: string;
      waived: string;
    } | null;
    repaidPercent: number;
    paidCount: number;
    lateCount: number;
    instalmentCount: number;
    remainingCount: number;
  };
  next: { number: number; dueDate: string; amount: string; state: InstalmentState } | null;
  schedule: ScheduleRow[];
  payments: Array<{
    id: string;
    amount: string;
    channel: string;
    reference: string | null;
    receivedOn: string;
    note: string | null;
  }>;
  pendingPayments: Array<{ id: string; amount: string; requestedAt: string }>;
  canRequestMomo: boolean;
  pendingRestructure: {
    id: string;
    type: 'EXTEND_TERM' | 'PAYMENT_HOLIDAY';
    reason: string | null;
    previousInstalment: string;
    newInstalment: string;
    newTermMonths: number;
    capitalisedInterest: string;
    requestedById: string;
    requestedBy: string | null;
    requestedAt: string;
  } | null;
  activity: Array<{
    kind: 'payment' | 'system' | 'disbursement' | 'restructure' | 'contact';
    title: string;
    at: string;
    by: string;
  }>;
}

export interface BorrowerListItem {
  code: string;
  name: string;
  type: 'INDIVIDUAL' | 'BUSINESS';
  businessName: string | null;
  phone: string;
  location: string;
  kycStatus: LoanDetail['borrower']['kycStatus'];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  score: number | null;
  activeLoans: number;
  officerName: string | null;
}

export interface BorrowerProfile {
  code: string;
  name: string;
  initials: string;
  firstName: string;
  subtitle: string[];
  tags: Array<{ label: string; tone: PillToneName }>;
  score: {
    value: number;
    label: string;
    percent: number;
    updatedOn: string;
    change: number | null;
  } | null;
  onTimeRateBps: number | null;
  debtToIncomeBps: number | null;
  documents: Array<{ name: string; meta: string; status: string; tone: PillToneName }>;
  contact: {
    phone: string;
    nationalId: string | null;
    momoLinked: boolean;
    sector: string | null;
    monthlyRevenue: string | null;
    officerName: string | null;
  };
  aiSummary: {
    text: string;
    reasons: Array<{ kind: 'why' | 'watch'; text: string }>;
    updatedOn: string;
    modelVersion: string;
  } | null;
  totals: { lifetimeBorrowed: string; currentlyOwed: string; preApprovedLimit: string | null };
  loans: Array<{
    code: string;
    productName: string;
    principal: string;
    period: string;
    status: LoanListItem['status'];
    statusLabel: string;
  }>;
  history: { cells: Array<PaymentTiming | 'MISSED' | 'UPCOMING'>; summary: string };
  notes: Array<{ id: string; body: string; author: string | null; createdOn: string }>;
}

// ── Phase 2: collections, MoMo, SMS ─────────────────────────────────────

export type ArrearsBucket = 'DPD_1_30' | 'DPD_31_90' | 'DPD_90_PLUS';

export interface CollectionsQueue {
  asOf: string;
  metrics: {
    inArrears: number;
    newThisWeek: number;
    balanceAtRisk: string;
    atRiskBps: number;
    promisesThisWeek: number;
    promisedAmount: string;
    recoveredThisMonth: string;
  };
  buckets: Record<ArrearsBucket, number>;
  items: Array<{
    loanCode: string;
    borrowerCode: string;
    name: string;
    initials: string;
    firstName: string;
    phone: string;
    dpd: number;
    bucket: ArrearsBucket;
    overdue: string;
    outstanding: string;
    lastContact: string;
    nextAction: 'SMS' | 'CALL' | 'FOLLOW_UP' | 'FIELD_VISIT' | 'WAIT';
    nextActionLabel: string;
    assignedToId: string | null;
    mine: boolean;
  }>;
}

export interface CollectionsAccount {
  loanCode: string;
  borrowerCode: string;
  name: string;
  initials: string;
  firstName: string;
  phone: string;
  momoLinked: boolean;
  overdue: string;
  outstanding: string;
  promise: { amount: string; date: string } | null;
  log: Array<{ id: string; text: string; when: string }>;
}

export interface AiApproach {
  bestTime: string;
  offer: string;
  odds: string;
  smsKinyarwanda: string;
  model: string;
}

export interface AiApproachResponse {
  approach: AiApproach | null;
  reason: 'not_configured' | 'unavailable' | null;
}

// ── Phase 4: reports ────────────────────────────────────────────────────

export type ReportPeriod = 'Q' | 'YTD' | '12M';

export interface Report {
  period: ReportPeriod;
  asOf: string;
  from: string;
  series: Array<{
    month: string;
    label: string;
    outstanding: string;
    activeLoans: number;
    averageLoan: string;
    par30Bps: number;
    yieldBps: number;
  }>;
  products: Array<{ name: string; outstanding: string; shareBps: number }>;
  officers: Array<{
    name: string;
    initials: string;
    activeLoans: number;
    portfolio: string;
    par30Bps: number;
    collectionRateBps: number | null;
  }>;
}

// ── Phase 5: AI ─────────────────────────────────────────────────────────

export interface AiStatus {
  configured: boolean;
  model: string | null;
  askYourData: boolean;
}

export interface EarlyWarning {
  available: boolean;
  asOf?: string;
  modelVersion?: string;
  flagged: Array<{
    loanCode: string;
    name: string;
    initials: string;
    signals: string[];
    risk: 'high' | 'medium';
  }>;
  signals: Array<{ text: string; count: number }>;
  checkInsSent?: boolean;
}

export type AskAnswer =
  | {
      ok: true;
      question: string;
      sql: string;
      rowCount: number;
      headline: string;
      body: string;
      bars: Array<{ label: string; value: number }>;
      unit: string;
      source: string;
      model: string;
    }
  | { ok: false; question: string; sql: string; error: string };

export interface FairnessRow {
  dimension: 'gender' | 'district';
  group: string;
  borrowers: number;
  averageScore: number;
  approveShare: number;
}
