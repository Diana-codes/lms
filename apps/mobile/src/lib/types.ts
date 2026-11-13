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
