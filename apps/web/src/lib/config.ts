/** The system's name, shown where no lender name is loaded yet. */
export const PRODUCT_NAME = 'BF Loan Management System';

/**
 * Multi-company hosting (companies by subdomain, platform admin at
 * admin.<domain>). Off: this system belongs to Bridge to Finance alone.
 */
export const MULTI_COMPANY = process.env.MULTI_COMPANY === 'true';

/** Server-side only: where the API lives. The browser uses /api instead. */
export const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** The lender's public website, linked from the sign-in pages. Optional. */
export const SITE_URL = process.env.SITE_URL?.replace(/\/$/, '') || null;

/** Multi-company only: companies are reached at <slug>.<APP_BASE_DOMAIN>. */
export const APP_BASE_DOMAIN = (process.env.APP_BASE_DOMAIN ?? 'localhost').toLowerCase();

export const ACCESS_COOKIE = 'kl_access';
export const REFRESH_COOKIE = 'kl_refresh';
/** Platform admin session, set by the API on admin.<domain> (multi-company only). */
export const PLATFORM_COOKIE = 'kp_access';

/** Header that tells the API which company a request is for. */
export const COMPANY_HEADER = 'x-company';

/** Subdomains that never name a company (mirrors the API's list). */
const RESERVED = new Set(['www', 'api', 'app', 'admin', 'platform', 'mail', 'static']);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * The company named by the address the console was opened at, when
 * MULTI_COMPANY is on. Null otherwise: the API serves its one company.
 */
export function companySlugFromHost(host: string | null | undefined): string | null {
  if (!MULTI_COMPANY || !host) return null;
  const name = host.toLowerCase().replace(/:\d+$/, '');
  if (!name.endsWith(`.${APP_BASE_DOMAIN}`)) return null;
  const label = name.slice(0, -(APP_BASE_DOMAIN.length + 1));
  if (label.includes('.') || RESERVED.has(label) || !SLUG.test(label)) return null;
  return label;
}

/** The platform admin console lives at admin.<APP_BASE_DOMAIN> (multi-company only). */
export function isPlatformHost(host: string | null | undefined): boolean {
  if (!MULTI_COMPANY || !host) return false;
  return host.toLowerCase().replace(/:\d+$/, '') === `admin.${APP_BASE_DOMAIN}`;
}

/** Headers naming the company, for calls the console server makes to the API. */
export function companyHeaders(host: string | null | undefined): Record<string, string> {
  const slug = companySlugFromHost(host);
  return slug ? { [COMPANY_HEADER]: slug } : {};
}
