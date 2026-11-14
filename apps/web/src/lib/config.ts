/** Server-side only: where the API lives. The browser uses /api instead. */
export const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** Companies are reached at <slug>.<APP_BASE_DOMAIN>, e.g. demo.localhost:3000. */
export const APP_BASE_DOMAIN = (process.env.APP_BASE_DOMAIN ?? 'localhost').toLowerCase();

export const ACCESS_COOKIE = 'kl_access';
export const REFRESH_COOKIE = 'kl_refresh';

/** Header that tells the API which company a request is for. */
export const COMPANY_HEADER = 'x-company';

/** Subdomains that never name a company (mirrors the API's list). */
const RESERVED = new Set(['www', 'api', 'app', 'admin', 'platform', 'mail', 'static']);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/**
 * The company named by the address the console was opened at: "bf" for
 * bf.koralend.rw. Null for the bare domain (development falls back to the
 * API's default company).
 */
export function companySlugFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const name = host.toLowerCase().replace(/:\d+$/, '');
  if (!name.endsWith(`.${APP_BASE_DOMAIN}`)) return null;
  const label = name.slice(0, -(APP_BASE_DOMAIN.length + 1));
  if (label.includes('.') || RESERVED.has(label) || !SLUG.test(label)) return null;
  return label;
}

/** Headers naming the company, for calls the console server makes to the API. */
export function companyHeaders(host: string | null | undefined): Record<string, string> {
  const slug = companySlugFromHost(host);
  return slug ? { [COMPANY_HEADER]: slug } : {};
}
