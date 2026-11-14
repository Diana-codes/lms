import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import { ENV, type Env } from '../config/env';
import type { Language } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompaniesService } from './companies.service';
import {
  CompanySecretsService,
  SECRET,
  type SecretsInput,
  webhookUrls,
} from './company-secrets.service';
import { requireCompanyId } from './company-context';

/** What a company's own administrators may change. The rest is set by the platform. */
export interface BrandingInput {
  brandName?: string | null;
  brandColor?: string | null;
  accentColor?: string | null;
  logoUrl?: string | null;
  defaultLanguage?: Language;
}

/**
 * A company's settings, managed by its own administrators: branding, its
 * MoMo and SMS accounts and its webhook secret. Runs on the company login,
 * whose column grants (scripts/app-role.mjs) only allow these fields of
 * the Company row to change.
 */
@Injectable()
export class CompanySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: CompanySecretsService,
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async get() {
    const id = requireCompanyId();
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id } });
    const secrets = await this.secrets.configured();
    return {
      slug: company.slug,
      name: company.name,
      legalName: company.legalName,
      country: company.country,
      currency: company.currency,
      timezone: company.timezone,
      defaultLanguage: company.defaultLanguage,
      brandName: company.brandName,
      brandColor: company.brandColor,
      accentColor: company.accentColor,
      logoUrl: company.logoUrl,
      features: { ai: company.aiFeatures, autoApprove: company.autoApprove },
      secrets,
      webhookConfigured: secrets[SECRET.webhookToken],
    };
  }

  async updateBranding(input: BrandingInput, actorId: string, meta: RequestMeta) {
    const id = requireCompanyId();
    await this.prisma.company.update({
      where: { id },
      data: {
        brandName: input.brandName === undefined ? undefined : input.brandName?.trim() || null,
        brandColor: input.brandColor,
        accentColor: input.accentColor,
        logoUrl: input.logoUrl,
        defaultLanguage: input.defaultLanguage,
      },
    });
    this.companies.invalidate();
    await this.audit.record({
      action: 'company.settings.update',
      actorId,
      entityType: 'Company',
      entityId: id,
      metadata: { changes: Object.keys(input) },
      ...meta,
    });
    return this.get();
  }

  async setSecrets(input: SecretsInput, actorId: string, meta: RequestMeta) {
    const changed = await this.secrets.setMany(input);
    // Only which settings changed is logged, never their values.
    await this.audit.record({
      action: 'company.settings.secrets',
      actorId,
      entityType: 'Company',
      entityId: requireCompanyId(),
      metadata: { changed },
      ...meta,
    });
    return this.secrets.configured();
  }

  /** A new webhook secret, shown once with the callback addresses to give the providers. */
  async rotateWebhookToken(actorId: string, meta: RequestMeta) {
    const token = await this.secrets.rotateWebhookToken();
    this.companies.invalidate();
    await this.audit.record({
      action: 'company.settings.webhook_rotate',
      actorId,
      entityType: 'Company',
      entityId: requireCompanyId(),
      ...meta,
    });
    return { webhookToken: token, urls: webhookUrls(this.env.PUBLIC_API_URL, token) };
  }
}
