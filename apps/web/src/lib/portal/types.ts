/** Shapes returned by the borrower `/app` API. */

export interface PortalHome {
  language: 'EN' | 'RW';
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
}

export interface PortalApplyOptions {
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

export interface PortalQuote {
  monthly: string;
  totalInterest: string;
  totalToRepay: string;
  firstPayment: string;
  annualRateBps: number;
  affordability: { affordable: boolean; ratio: string; limit: string } | null;
}

export interface PortalSchedule {
  code: string;
  principal: string;
  annualRateBps: number;
  rows: Array<{
    number: number;
    dueDate: string;
    amount: string;
    remaining: string;
    state: string;
  }>;
}

export interface PortalProfile {
  language: 'EN' | 'RW';
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
  }>;
  consents: Array<{ type: string; grantedAt: string }>;
}

export interface PortalNotification {
  id: string;
  title: string;
  kind: string;
  at: string;
  read: boolean;
}
