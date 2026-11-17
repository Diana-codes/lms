import type { DocumentType } from '@kora/core';

export interface Home {
  firstName: string;
  initials: string;
  unread: number;
  loan: {
    code: string;
    instalmentCount: number;
    paidCount: number;
    repaidPercent: number;
    totalLeft: string;
    next: {
      number: number;
      dueDate: string;
      amount: string;
      state: 'PAID' | 'PARTIAL' | 'OVERDUE' | 'DUE_NEXT' | 'UPCOMING';
    } | null;
    pendingPayment: { id: string } | null;
    activity: Array<{ id: string; title: string; when: string; amount: string }>;
  } | null;
  pendingLoan: { code: string } | null;
  application: { code: string; amount: string; stage: string; productName: string } | null;
  offer: {
    id: string;
    maxAmount: string;
    termMonths: number;
    productCode: string;
    productName: string;
    annualRateBps: number;
  } | null;
  wallet: string | null;
  support: { officerName: string | null; branch: string | null };
  /** Required documents still to send (missing, rejected or expired). */
  documentsNeeded: number;
}

export type DocumentState = 'MISSING' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED' | 'WAIVED';

export interface Documents {
  applicationCode: string | null;
  productName: string | null;
  required: number;
  received: number;
  needsAction: number;
  items: Array<{
    type: DocumentType;
    state: DocumentState;
    required: boolean;
    reason: string | null;
    /** The latest file of this type, if one was sent. */
    documentId: string | null;
    hasFile: boolean;
    fileType: 'photo' | 'pdf' | null;
    /** Not reviewed yet, so it can still be removed. */
    canRemove: boolean;
  }>;
}

export interface ApplyOptions {
  products: Array<{
    code: string;
    name: string;
    kind: string;
    annualRateBps: number;
    minAmount: string;
    maxAmount: string;
    terms: number[];
  }>;
  preApprovedLimit: string | null;
  purposes: string[];
  prefill: {
    businessName: string | null;
    sector: string | null;
    monthlyRevenue: string | null;
    nationalIdMasked: string | null;
    kycVerified: boolean;
  };
  wallet: string | null;
}

export interface Quote {
  monthly: string;
  totalInterest: string;
  totalToRepay: string;
  firstPayment: string;
  annualRateBps: number;
  /** The fee comes out of the payout: this is what reaches the wallet. */
  fee: string;
  youReceive: string;
  totalCost: string;
  aprBps: number;
  affordability: { affordable: boolean; ratio: string; limit: string } | null;
}

export interface Schedule {
  code: string;
  principal: string;
  annualRateBps: number;
  rows: Array<{
    number: number;
    dueDate: string;
    amount: string;
    /** Late penalties on this instalment, included in remaining. */
    penalty: string;
    remaining: string;
    state: Home['loan'] extends infer L
      ? L extends { next: infer N }
        ? N extends { state: infer S }
          ? S
          : never
        : never
      : never;
  }>;
}

export interface Profile {
  code: string;
  name: string;
  phone: string;
  nationalId: string | null;
  kycStatus: string;
  business: { name: string; sector: string | null } | null;
  loans: Array<{
    code: string;
    productName: string;
    principal: string;
    status: string;
    disbursedOn: string | null;
    hasAgreement: boolean;
  }>;
  consents: Array<{ type: string; grantedAt: string }>;
}

/** What the user has filled in across the three apply steps. */
export interface Draft {
  productCode: string;
  amount: bigint;
  termMonths: number;
  purpose: string;
  businessName: string;
  businessSector: string;
  monthlyRevenue: string;
  nationalId: string;
  shareMomoHistory: boolean;
  idPhotoKey: string | null;
  selfieKey: string | null;
}

export interface Statement {
  code: string;
  productName: string;
  principal: string;
  disbursedOn: string | null;
  totalPaid: string;
  leftToPay: string;
  payments: Array<{
    id: string;
    amount: string;
    channel: string;
    receivedOn: string;
    note: string;
    reference: string | null;
  }>;
}

export interface Insights {
  instalmentsPaid: number;
  paidOnTime: number;
  paidEarly: number;
  overdueNow: number;
  onTimeRatePct: number | null;
  paidThisYear: string;
  paidAllTime: string;
  loansRepaid: number;
  preApprovedLimit: string | null;
  months: Array<{ month: string; amount: string }>;
}

export type Tab = 'home' | 'loans' | 'insights' | 'profile';

/** The Key Facts and full agreement shown before applying. */
export interface AgreementPreview {
  version: string;
  keyFacts: Array<{ label: string; value: string }>;
  /** Plain text; "# " title, "## " heading, "| label | value" a key fact row. */
  body: string;
}

/** GET /app/auth/register: what the sign-up form needs. */
export interface RegistrationOptions {
  branches: Array<{ code: string; name: string; district: string }>;
  sectors: string[];
  consentVersion: string;
  /** The privacy notice, one point per line. */
  privacy: string[];
}

/** POST /app/auth/verify for a number with no account yet. */
export interface RegistrationNeeded {
  registrationToken: string;
  phone: string;
}
