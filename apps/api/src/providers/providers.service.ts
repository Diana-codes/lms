import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { PiiCrypto } from '../common/pii-crypto';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { requireCompanyId } from '../tenancy/company-context';
import { CompanySecretsService, SECRET } from '../tenancy/company-secrets.service';
import { MomoError, type MomoGateway } from './momo.gateway';
import { MtnMomoGateway } from './momo.mtn';
import { MomoSimulator } from './momo.simulator';
import { AfricasTalkingGateway, type SmsGateway, SmsSimulator } from './sms.gateway';

const fingerprint = (...parts: Array<string | undefined>) =>
  createHash('sha256')
    .update(parts.map((p) => p ?? '').join('\u0000'))
    .digest('base64url');

/**
 * Gives each piece of work the providers of the company it runs for. Every
 * lender uses its own MoMo and SMS accounts (company secrets); with none set,
 * development and tests use the local simulators, and production refuses.
 * The MoMo environment (sandbox or live, base URL, currency) is a platform
 * setting from the environment.
 */
@Injectable()
export class ProvidersService {
  private readonly logger = new Logger('Providers');
  private readonly momoGateways = new Map<string, { key: string; gateway: MomoGateway }>();
  private readonly smsGateways = new Map<string, { key: string; gateway: SmsGateway }>();
  private readonly momoSimulator: MomoSimulator;
  private readonly smsSimulator = new SmsSimulator();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly crypto: PiiCrypto,
    private readonly secrets: CompanySecretsService,
  ) {
    this.momoSimulator = new MomoSimulator(prisma);
  }

  /** The current company's MoMo account, or the simulator outside production. */
  async momo(): Promise<MomoGateway> {
    const companyId = requireCompanyId();
    const [collection, disbursement, webhookToken] = await Promise.all([
      this.secrets.get(SECRET.momoCollectionKey),
      this.secrets.get(SECRET.momoDisbursementKey),
      this.secrets.get(SECRET.webhookToken),
    ]);
    if (!collection || !disbursement) {
      if (this.env.NODE_ENV === 'production')
        throw new MomoError('MoMo is not set up for this company yet');
      return this.momoSimulator;
    }
    const key = fingerprint(collection, disbursement, webhookToken);
    const cached = this.momoGateways.get(companyId);
    if (cached?.key === key) return cached.gateway;
    const gateway = new MtnMomoGateway(
      {
        MOMO_COLLECTION_SUBSCRIPTION_KEY: collection,
        MOMO_DISBURSEMENT_SUBSCRIPTION_KEY: disbursement,
        MOMO_BASE_URL: this.env.MOMO_BASE_URL,
        MOMO_TARGET_ENVIRONMENT: this.env.MOMO_TARGET_ENVIRONMENT,
        MOMO_CURRENCY: this.env.MOMO_CURRENCY,
        PUBLIC_API_URL: this.env.PUBLIC_API_URL,
        WEBHOOK_TOKEN: webhookToken,
      },
      this.prisma,
      this.crypto,
    );
    this.momoGateways.set(companyId, { key, gateway });
    this.logger.log(`MoMo: MTN (${this.env.MOMO_TARGET_ENVIRONMENT}) for company ${companyId}`);
    return gateway;
  }

  /** The current company's SMS account, or the simulator outside production. */
  async sms(): Promise<SmsGateway> {
    const companyId = requireCompanyId();
    const [apiKey, username, senderId] = await Promise.all([
      this.secrets.get(SECRET.smsApiKey),
      this.secrets.get(SECRET.smsUsername),
      this.secrets.get(SECRET.smsSenderId),
    ]);
    if (!apiKey) {
      if (this.env.NODE_ENV === 'production') {
        throw new Error("SMS is not set up for this company yet (no Africa's Talking key)");
      }
      return this.smsSimulator;
    }
    const key = fingerprint(apiKey, username, senderId);
    const cached = this.smsGateways.get(companyId);
    if (cached?.key === key) return cached.gateway;
    const gateway = new AfricasTalkingGateway({
      username: username ?? 'sandbox',
      apiKey,
      senderId,
    });
    this.smsGateways.set(companyId, { key, gateway });
    return gateway;
  }

  /** The merchant code quoted in reminders ("MoMo Pay 123456"), if the company has one. */
  momoPayCode(): Promise<string | undefined> {
    return this.secrets.get(SECRET.momoPayCode);
  }
}
