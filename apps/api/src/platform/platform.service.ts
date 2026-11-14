import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestMeta } from '../auth/auth.service';
import { hashPassword } from '../auth/password';
import { PiiCrypto } from '../common/pii-crypto';
import { ENV, type Env } from '../config/env';
import type { CompanyStatus, Language } from '../generated/prisma/client';
import { PlatformPrismaService } from '../prisma/prisma.service';
import { CompaniesService, RESERVED_SLUGS } from '../tenancy/companies.service';
import { runAsCompany } from '../tenancy/company-context';
import {
  CompanySecretsService,
  type SecretsInput,
  webhookUrls,
} from '../tenancy/company-secrets.service';
import { PlatformAuthService } from './platform-auth.service';
import { provisionCompany } from './provision';

export interface CreateCompanyInput {
  slug: string;
  name: string;
  legalName?: string;
  brandName?: string;
  timezone?: string;
  defaultLanguage?: Language;
  aiFeatures?: boolean;
  autoApprove?: boolean;
  admin: { email: string; firstName: string; lastName: string; password: string };
}

export interface UpdateCompanyInput {
  name?: string;
  legalName?: string | null;
  brandName?: string | null;
  brandColor?: string | null;
  accentColor?: string | null;
  logoUrl?: string | null;
  timezone?: string;
  defaultLanguage?: Language;
  status?: CompanyStatus;
  aiFeatures?: boolean;
  autoApprove?: boolean;
}

/**
 * Company administration for platform admins. Uses the owner database login,
 * which sees every company; company secrets are written as that company.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly db: PlatformPrismaService,
    private readonly crypto: PiiCrypto,
    private readonly companies: CompaniesService,
    private readonly secrets: CompanySecretsService,
    private readonly auth: PlatformAuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list() {
    const companies = await this.db.company.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { users: { where: { isActive: true } }, borrowers: true } },
        usage: { orderBy: { day: 'desc' }, take: 1 },
      },
    });
    return companies.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      brandName: c.brandName,
      status: c.status,
      aiFeatures: c.aiFeatures,
      autoApprove: c.autoApprove,
      createdAt: c.createdAt,
      activeStaff: c._count.users,
      borrowers: c._count.borrowers,
      latestUsage: c.usage[0] ?? null,
    }));
  }

  async detail(id: string) {
    const company = await this.db.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException('No such company');
    const [admins, secrets, usage] = await Promise.all([
      this.db.user.findMany({
        where: { companyId: id, role: 'ADMIN' },
        select: { id: true, email: true, firstName: true, lastName: true, isActive: true },
        orderBy: { createdAt: 'asc' },
      }),
      runAsCompany(id, () => this.secrets.configured()),
      this.usage(id),
    ]);
    const { webhookTokenHash, ...rest } = company;
    return { ...rest, webhookConfigured: webhookTokenHash != null, admins, secrets, usage };
  }

  async create(input: CreateCompanyInput, adminId: string, meta: RequestMeta) {
    const slug = input.slug.trim().toLowerCase();
    if (RESERVED_SLUGS.has(slug)) throw new BadRequestException(`"${slug}" is reserved`);
    if (await this.db.company.findUnique({ where: { slug } })) {
      throw new ConflictException(`A company already uses "${slug}"`);
    }
    const { company, webhookToken } = await provisionCompany(
      this.db,
      {
        slug,
        name: input.name.trim(),
        legalName: input.legalName?.trim() || null,
        brandName: input.brandName?.trim() || null,
        timezone: input.timezone,
        defaultLanguage: input.defaultLanguage,
        aiFeatures: input.aiFeatures ?? false,
        autoApprove: input.autoApprove ?? false,
      },
      { crypto: this.crypto },
    );
    const firstAdmin = await this.db.user.create({
      data: {
        companyId: company.id,
        email: input.admin.email.trim().toLowerCase(),
        passwordHash: await hashPassword(input.admin.password),
        firstName: input.admin.firstName.trim(),
        lastName: input.admin.lastName.trim(),
        role: 'ADMIN',
        mustChangePassword: true,
      },
      select: { id: true, email: true },
    });
    await this.auth.audit(
      'platform.company.create',
      adminId,
      { slug, admin: firstAdmin.email },
      meta,
      {
        companyId: company.id,
        entityType: 'Company',
        entityId: company.id,
      },
    );
    this.companies.invalidate();
    // The webhook secret is shown once; only its hash and an encrypted copy are kept.
    return { company: await this.detail(company.id), firstAdmin, webhookToken };
  }

  async update(id: string, patch: UpdateCompanyInput, adminId: string, meta: RequestMeta) {
    if (!(await this.db.company.findUnique({ where: { id }, select: { id: true } }))) {
      throw new NotFoundException('No such company');
    }
    await this.db.company.update({ where: { id }, data: patch });
    await this.auth.audit(
      'platform.company.update',
      adminId,
      { changes: Object.keys(patch) },
      meta,
      {
        companyId: id,
        entityType: 'Company',
        entityId: id,
      },
    );
    this.companies.invalidate();
    return this.detail(id);
  }

  async setSecrets(id: string, input: SecretsInput, adminId: string, meta: RequestMeta) {
    await this.detail(id);
    const changed = await runAsCompany(id, () => this.secrets.setMany(input));
    // Only which settings changed is logged, never their values.
    await this.auth.audit('platform.company.secrets', adminId, { changed }, meta, {
      companyId: id,
      entityType: 'Company',
      entityId: id,
    });
    return runAsCompany(id, () => this.secrets.configured());
  }

  async rotateWebhookToken(id: string, adminId: string, meta: RequestMeta) {
    await this.detail(id);
    const token = await runAsCompany(id, () => this.secrets.rotateWebhookToken());
    await this.auth.audit('platform.company.webhook_rotate', adminId, undefined, meta, {
      companyId: id,
      entityType: 'Company',
      entityId: id,
    });
    return { webhookToken: token, urls: webhookUrls(this.env.PUBLIC_API_URL, token) };
  }

  usage(id: string) {
    return this.db.companyUsageDaily.findMany({
      where: { companyId: id },
      orderBy: { day: 'desc' },
      take: 31,
    });
  }
}
