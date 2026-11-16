import { Inject, Injectable } from '@nestjs/common';
import { PiiCrypto } from '../common/pii-crypto';
import { ENV, type Env } from '../config/env';
import type { CompanyStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { type CompanyContext, type CompanyFeatures, runAsCompany } from './company-context';

export interface CompanyInfo {
  id: string;
  slug: string;
  name: string;
  /** What borrowers and staff see: the brand name, or else the name. */
  displayName: string;
  status: CompanyStatus;
  timezone: string;
  features: CompanyFeatures;
}

/** Subdomains that never name a company. */
export const RESERVED_SLUGS = new Set(['www', 'api', 'app', 'admin', 'platform', 'mail', 'static']);
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const CACHE_MS = 30_000;

const SELECT = {
  id: true,
  slug: true,
  name: true,
  brandName: true,
  status: true,
  timezone: true,
  aiFeatures: true,
  autoApprove: true,
  staffTwoFactor: true,
  borrowerOtp: true,
} as const;

type Row = {
  id: string;
  slug: string;
  name: string;
  brandName: string | null;
  status: CompanyStatus;
  timezone: string;
  aiFeatures: boolean;
  autoApprove: boolean;
  staffTwoFactor: boolean;
  borrowerOtp: boolean;
};

const toInfo = (r: Row): CompanyInfo => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  displayName: r.brandName?.trim() || r.name,
  status: r.status,
  timezone: r.timezone,
  features: {
    ai: r.aiFeatures,
    autoApprove: r.autoApprove,
    staffTwoFactor: r.staffTwoFactor,
    borrowerOtp: r.borrowerOtp,
  },
});

/**
 * Finds companies for request routing. Any company's public details are
 * readable through the company login (see the Company policies), so this
 * works before anyone has signed in. Results are cached briefly; a suspension
 * or a feature switch takes effect within CACHE_MS.
 */
@Injectable()
export class CompaniesService {
  private readonly cache = new Map<string, { at: number; value: CompanyInfo | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PiiCrypto,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The company slug in a Host header, e.g. "bf" from "bf.koralend.rw:443". */
  slugFromHost(host: string | undefined): string | null {
    if (!host) return null;
    const name = host.toLowerCase().replace(/:\d+$/, '');
    const base = this.env.APP_BASE_DOMAIN;
    if (!name.endsWith(`.${base}`)) return null;
    const label = name.slice(0, -(base.length + 1));
    if (label.includes('.') || RESERVED_SLUGS.has(label) || !SLUG_PATTERN.test(label)) return null;
    return label;
  }

  /** Whether a browser Origin belongs to the console (any company subdomain). */
  isAllowedOrigin(origin: string): boolean {
    let url: URL;
    let console: URL;
    try {
      url = new URL(origin);
      console = new URL(this.env.WEB_ORIGIN);
    } catch {
      return false;
    }
    if (url.protocol !== console.protocol || url.port !== console.port) return false;
    const base = this.env.APP_BASE_DOMAIN;
    return (
      url.hostname === console.hostname ||
      url.hostname === base ||
      url.hostname.endsWith(`.${base}`)
    );
  }

  async bySlug(slug: string): Promise<CompanyInfo | null> {
    const hit = this.cache.get(`slug:${slug}`);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const row = await this.prisma.company.findUnique({ where: { slug }, select: SELECT });
    return this.remember(`slug:${slug}`, row);
  }

  async byId(id: string): Promise<CompanyInfo | null> {
    const hit = this.cache.get(`id:${id}`);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const row = await this.prisma.company.findUnique({ where: { id }, select: SELECT });
    return this.remember(`id:${id}`, row);
  }

  /** The company a provider webhook URL belongs to, from the secret in it. */
  async byWebhookToken(token: string): Promise<CompanyInfo | null> {
    if (!token || token.length < 16 || token.length > 200) return null;
    const row = await this.prisma.company.findUnique({
      where: { webhookTokenHash: this.crypto.lookupHash(token) },
      select: SELECT,
    });
    return row ? toInfo(row) : null;
  }

  /** What the console shows for a company before and after sign-in: its name and branding. */
  async publicProfile(id: string) {
    const c = await this.prisma.company.findUnique({
      where: { id },
      select: {
        slug: true,
        name: true,
        brandName: true,
        brandColor: true,
        accentColor: true,
        logoUrl: true,
        defaultLanguage: true,
        aiFeatures: true,
        autoApprove: true,
        staffTwoFactor: true,
        borrowerOtp: true,
      },
    });
    if (!c) return null;
    return {
      slug: c.slug,
      name: c.name,
      displayName: c.brandName?.trim() || c.name,
      brandColor: c.brandColor,
      accentColor: c.accentColor,
      logoUrl: c.logoUrl,
      defaultLanguage: c.defaultLanguage,
      features: {
        ai: c.aiFeatures,
        autoApprove: c.autoApprove,
        staffTwoFactor: c.staffTwoFactor,
        borrowerOtp: c.borrowerOtp,
      },
    };
  }

  /** Every active company, for background jobs. */
  async active(): Promise<CompanyInfo[]> {
    const rows = await this.prisma.company.findMany({
      where: { status: 'ACTIVE' },
      select: SELECT,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toInfo);
  }

  /** Fill in a request or job context for a company. */
  enter(context: CompanyContext, company: CompanyInfo): void {
    context.companyId = company.id;
    context.slug = company.slug;
    context.features = company.features;
    context.displayName = company.displayName;
    context.timezone = company.timezone;
  }

  /** Run `fn` as a company, with its features and name in the context (jobs, webhooks). */
  runAs<T>(company: CompanyInfo, fn: () => T): T {
    return runAsCompany(company.id, fn, {
      slug: company.slug,
      features: company.features,
      displayName: company.displayName,
      timezone: company.timezone,
    });
  }

  /** Forget cached details, e.g. after a platform admin suspends a company. */
  invalidate(): void {
    this.cache.clear();
  }

  private remember(key: string, row: Row | null): CompanyInfo | null {
    const value = row ? toInfo(row) : null;
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }
}
