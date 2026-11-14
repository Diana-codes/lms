import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PiiCrypto } from '../common/pii-crypto';
import { PrismaService } from '../prisma/prisma.service';
import { requireCompanyId } from './company-context';

/**
 * A company's own provider settings. Each lender brings its own MoMo and SMS
 * accounts, so money and messages never go through another lender's account.
 */
export const SECRET = {
  momoCollectionKey: 'momo.collection_key',
  momoDisbursementKey: 'momo.disbursement_key',
  /** The merchant code quoted in reminder SMS ("MoMo Pay 123456"). */
  momoPayCode: 'momo.pay_code',
  smsUsername: 'sms.username',
  smsApiKey: 'sms.api_key',
  smsSenderId: 'sms.sender_id',
  /** The secret in this company's provider webhook URLs. */
  webhookToken: 'webhook.token',
} as const;

export type SecretKey = (typeof SECRET)[keyof typeof SECRET];

const CACHE_MS = 60_000;

/**
 * Reads and writes the current company's secrets. Values are encrypted at
 * rest and stored per company (row-level security keeps them separate).
 */
@Injectable()
export class CompanySecretsService {
  private readonly cache = new Map<string, { at: number; value: string | undefined }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: PiiCrypto,
  ) {}

  async get(key: SecretKey): Promise<string | undefined> {
    const cacheKey = `${requireCompanyId()}:${key}`;
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const row = await this.prisma.providerCredential.findFirst({ where: { key } });
    const value = row ? this.crypto.decrypt(row.valueEnc) : undefined;
    this.cache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  /** Set (or with null, remove) one of the current company's secrets. */
  async set(key: SecretKey, value: string | null): Promise<void> {
    const companyId = requireCompanyId();
    if (value == null || value.trim() === '') {
      await this.prisma.providerCredential.deleteMany({ where: { key } });
    } else {
      const valueEnc = this.crypto.encrypt(value.trim());
      await this.prisma.providerCredential.upsert({
        where: { companyId_key: { companyId, key } },
        update: { valueEnc },
        create: { key, valueEnc },
      });
    }
    if (key === SECRET.webhookToken) {
      await this.prisma.company.update({
        where: { id: companyId },
        data: { webhookTokenHash: value ? this.crypto.lookupHash(value.trim()) : null },
      });
    }
    this.cache.delete(`${companyId}:${key}`);
  }

  /** Give the company a fresh webhook secret; the old URLs stop working. */
  async rotateWebhookToken(): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await this.set(SECRET.webhookToken, token);
    return token;
  }

  /** Which secrets are set, without revealing them (for settings screens). */
  async configured(): Promise<Record<SecretKey, boolean>> {
    const rows = await this.prisma.providerCredential.findMany({ select: { key: true } });
    const set = new Set(rows.map((r) => r.key));
    return Object.fromEntries(Object.values(SECRET).map((k) => [k, set.has(k)])) as Record<
      SecretKey,
      boolean
    >;
  }
}
