import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The company a piece of work runs for. Set once per HTTP request (from the
 * subdomain, then confirmed by the sign-in token) and once per company in
 * background jobs. Every database connection the API hands out is told this
 * company first, and row-level security does the rest.
 */
export interface CompanyContext {
  companyId: string | null;
  /** The company's slug, when known. For logs and error messages only. */
  slug?: string;
  /** Optional features the company has switched on. Off when unknown. */
  features?: CompanyFeatures;
  /** The name borrowers see (the company's brand name, or its name). */
  displayName?: string;
  /** The company's time zone, e.g. "Africa/Kigali". */
  timezone?: string;
}

/** The lender's name for messages and documents; the product name when none is known. */
export function companyDisplayName(): string {
  return storage.getStore()?.displayName ?? 'Kora Lend';
}

export interface CompanyFeatures {
  /** Claude-written summaries, collections advice, SMS drafts, "Ask your data". */
  ai: boolean;
  /** The "approve low-risk" bulk action for policy-eligible applications. */
  autoApprove: boolean;
}

/** The current company's optional features; all off when no company is known. */
export function companyFeatures(): CompanyFeatures {
  return storage.getStore()?.features ?? { ai: false, autoApprove: false };
}

const storage = new AsyncLocalStorage<CompanyContext>();

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Run `fn` with a fresh, mutable context (filled in later in the request). */
export function runWithContext<T>(context: CompanyContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** Run `fn` as the given company (jobs, webhooks, scripts). */
export function runAsCompany<T>(
  companyId: string,
  fn: () => T,
  extra: Omit<CompanyContext, 'companyId'> = {},
): T {
  if (!UUID_PATTERN.test(companyId)) throw new Error('Not a company id');
  return storage.run({ companyId, ...extra }, fn);
}

export function companyContext(): CompanyContext | undefined {
  return storage.getStore();
}

/** The current company, or null when none has been established. */
export function currentCompanyId(): string | null {
  return storage.getStore()?.companyId ?? null;
}

/** The current company, for code that must not run without one. */
export function requireCompanyId(): string {
  const id = currentCompanyId();
  if (!id) throw new Error('No company is set for this work');
  return id;
}
