/** Shapes returned by the API's /platform routes. */

export interface PlatformAdmin {
  id: string;
  email: string;
  name: string;
  twoFactorEnabled: boolean;
}

export interface UsageDay {
  day: string;
  activeLoans: number;
  borrowers: number;
  activeStaff: number;
  loansDisbursed: number;
  smsSent: number;
}

export interface CompanyRow {
  id: string;
  slug: string;
  name: string;
  brandName: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  aiFeatures: boolean;
  autoApprove: boolean;
  createdAt: string;
  activeStaff: number;
  borrowers: number;
  latestUsage: UsageDay | null;
}

export interface CompanyDetail {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  brandName: string | null;
  brandColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  status: 'ACTIVE' | 'SUSPENDED';
  country: string;
  currency: string;
  timezone: string;
  defaultLanguage: 'EN' | 'RW' | 'FR';
  aiFeatures: boolean;
  autoApprove: boolean;
  createdAt: string;
  webhookConfigured: boolean;
  admins: Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
  }>;
  secrets: Record<string, boolean>;
  usage: UsageDay[];
}

/** The console address of a company, from the platform console's own address. */
export function companyUrl(slug: string, platformHost: string | null): string {
  const host = platformHost ?? 'admin.localhost:3000';
  const secure = !/localhost|127\.0\.0\.1/.test(host);
  return `${secure ? 'https' : 'http'}://${host.replace(/^admin\./, `${slug}.`)}`;
}
