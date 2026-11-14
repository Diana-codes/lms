import { randomBytes } from 'node:crypto';
import type { PiiCrypto } from '../common/pii-crypto';
import type { Company, Language, PrismaClient } from '../generated/prisma/client';
import { ACCOUNTS } from '../ledger/accounts';
import { SECRET } from '../tenancy/company-secrets.service';

export interface NewCompany {
  /** Optional fixed id (tests and the seed use one). */
  id?: string;
  slug: string;
  name: string;
  legalName?: string | null;
  brandName?: string | null;
  country?: string;
  currency?: string;
  timezone?: string;
  defaultLanguage?: Language;
  /** Optional features. Both default to off. */
  aiFeatures?: boolean;
  autoApprove?: boolean;
}

export interface ProvisionOptions {
  /** Needed to store the webhook secret. */
  crypto: PiiCrypto;
  /** A fixed webhook secret (tests, the dev seed). A random one otherwise. */
  webhookToken?: string;
}

/**
 * Create a company with everything it needs to start lending: its chart of
 * accounts and its webhook secret. Safe to run again for the same slug; an
 * existing company keeps its settings and secret. Must be given the owner
 * client (PlatformPrismaService, or the seed's client): a company login
 * cannot create companies.
 */
export async function provisionCompany(
  db: PrismaClient,
  input: NewCompany,
  options: ProvisionOptions,
): Promise<{ company: Company; webhookToken: string | null }> {
  const existing = await db.company.findUnique({ where: { slug: input.slug } });
  const webhookToken = existing
    ? null
    : (options.webhookToken ?? randomBytes(24).toString('base64url'));
  const company =
    existing ??
    (await db.company.create({
      data: {
        id: input.id,
        slug: input.slug,
        name: input.name,
        legalName: input.legalName ?? null,
        brandName: input.brandName ?? null,
        country: input.country,
        currency: input.currency,
        timezone: input.timezone,
        defaultLanguage: input.defaultLanguage,
        aiFeatures: input.aiFeatures ?? false,
        autoApprove: input.autoApprove ?? false,
        webhookTokenHash: options.crypto.lookupHash(webhookToken!),
      },
    }));
  if (webhookToken) {
    await db.providerCredential.create({
      data: {
        companyId: company.id,
        key: SECRET.webhookToken,
        valueEnc: options.crypto.encrypt(webhookToken),
      },
    });
  }
  for (const account of Object.values(ACCOUNTS)) {
    await db.ledgerAccount.upsert({
      where: { companyId_code: { companyId: company.id, code: account.code } },
      update: {},
      create: { ...account, companyId: company.id },
    });
  }
  return { company, webhookToken };
}
