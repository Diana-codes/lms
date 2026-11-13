import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { PiiCrypto } from '../common/pii-crypto';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import {
  MomoError,
  MomoGateway,
  type MomoRequest,
  type MomoResult,
  type MomoStatus,
} from './momo.gateway';

type Product = 'collection' | 'disbursement';

interface Token {
  value: string;
  expiresAt: number;
}

/**
 * MTN MoMo Open API. Collections and Disbursements are separate products,
 * each with its own subscription key, API user and access token.
 *
 * In the sandbox, the API user and key are created through the provisioning
 * API the first time they are needed, then kept (encrypted) in the database.
 * In production MTN issues them through the partner portal instead; put them
 * in ProviderCredential the same way.
 */
export class MtnMomoGateway extends MomoGateway {
  readonly name = 'mtn' as const;
  private readonly logger = new Logger('MtnMomo');
  private readonly tokens = new Map<Product, Token>();

  constructor(
    private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly crypto: PiiCrypto,
  ) {
    super();
  }

  async requestToPay(request: MomoRequest): Promise<void> {
    await this.send('collection', '/collection/v1_0/requesttopay', request, 'payer');
  }

  async transfer(request: MomoRequest): Promise<void> {
    await this.send('disbursement', '/disbursement/v1_0/transfer', request, 'payee');
  }

  requestToPayStatus(referenceId: string): Promise<MomoResult> {
    return this.status('collection', `/collection/v1_0/requesttopay/${referenceId}`);
  }

  transferStatus(referenceId: string): Promise<MomoResult> {
    return this.status('disbursement', `/disbursement/v1_0/transfer/${referenceId}`);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private subscriptionKey(product: Product): string {
    const key =
      product === 'collection'
        ? this.env.MOMO_COLLECTION_SUBSCRIPTION_KEY
        : this.env.MOMO_DISBURSEMENT_SUBSCRIPTION_KEY;
    if (!key) throw new MomoError(`No MoMo ${product} subscription key is configured`);
    return key;
  }

  private async send(
    product: Product,
    path: string,
    request: MomoRequest,
    party: 'payer' | 'payee',
  ) {
    const headers: Record<string, string> = {
      ...(await this.authHeaders(product)),
      'X-Reference-Id': request.referenceId,
      'Content-Type': 'application/json',
    };
    if (this.env.PUBLIC_API_URL && this.env.WEBHOOK_TOKEN) {
      headers['X-Callback-Url'] =
        `${this.env.PUBLIC_API_URL}/webhooks/momo/${product}/${this.env.WEBHOOK_TOKEN}`;
    }
    const res = await fetch(`${this.env.MOMO_BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        // Whole francs, sent as a string. Never a float.
        amount: request.amount.toString(),
        currency: this.env.MOMO_CURRENCY,
        externalId: request.externalId,
        [party]: { partyIdType: 'MSISDN', partyId: request.phone.replace(/^\+/, '') },
        payerMessage: request.message.slice(0, 160),
        payeeNote: request.externalId,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    // 202 Accepted means MTN has taken the request, not that money has moved.
    if (res.status !== 202) {
      throw new MomoError(`MoMo refused the request (${res.status}): ${await this.reason(res)}`);
    }
  }

  private async status(product: Product, path: string): Promise<MomoResult> {
    const res = await fetch(`${this.env.MOMO_BASE_URL}${path}`, {
      headers: await this.authHeaders(product),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404)
      return { status: 'FAILED', reason: 'MoMo has no record of this request' };
    if (!res.ok) throw new MomoError(`MoMo status check failed (${res.status})`);
    const body = (await res.json()) as {
      status?: string;
      financialTransactionId?: string;
      reason?: string | { code?: string; message?: string };
    };
    const status: MomoStatus =
      body.status === 'SUCCESSFUL' ? 'SUCCESSFUL' : body.status === 'FAILED' ? 'FAILED' : 'PENDING';
    const reason =
      typeof body.reason === 'string' ? body.reason : (body.reason?.message ?? body.reason?.code);
    return { status, financialTransactionId: body.financialTransactionId, reason };
  }

  private async authHeaders(product: Product): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await this.token(product)}`,
      'X-Target-Environment': this.env.MOMO_TARGET_ENVIRONMENT,
      'Ocp-Apim-Subscription-Key': this.subscriptionKey(product),
    };
  }

  private async token(product: Product): Promise<string> {
    const cached = this.tokens.get(product);
    if (cached && cached.expiresAt > Date.now() + 30_000) return cached.value;
    const { user, key } = await this.apiUser(product);
    const res = await fetch(`${this.env.MOMO_BASE_URL}/${product}/token/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${user}:${key}`).toString('base64')}`,
        'Ocp-Apim-Subscription-Key': this.subscriptionKey(product),
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok)
      throw new MomoError(`MoMo sign-in failed (${res.status}): ${await this.reason(res)}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.tokens.set(product, {
      value: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000,
    });
    return body.access_token;
  }

  /** The API user and key for a product: read from the database, or provisioned in the sandbox. */
  private async apiUser(product: Product): Promise<{ user: string; key: string }> {
    const name = `momo.${this.env.MOMO_TARGET_ENVIRONMENT}.${product}`;
    const stored = await this.prisma.providerCredential.findUnique({ where: { key: name } });
    if (stored)
      return JSON.parse(this.crypto.decrypt(stored.valueEnc)) as { user: string; key: string };
    if (this.env.MOMO_TARGET_ENVIRONMENT !== 'sandbox') {
      throw new MomoError(
        `MoMo ${product} API user is not set up for ${this.env.MOMO_TARGET_ENVIRONMENT}`,
      );
    }

    const user = randomUUID();
    const subscription = this.subscriptionKey(product);
    const host = this.env.PUBLIC_API_URL ? new URL(this.env.PUBLIC_API_URL).host : 'localhost';
    const created = await fetch(`${this.env.MOMO_BASE_URL}/v1_0/apiuser`, {
      method: 'POST',
      headers: {
        'X-Reference-Id': user,
        'Ocp-Apim-Subscription-Key': subscription,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ providerCallbackHost: host }),
      signal: AbortSignal.timeout(20_000),
    });
    if (created.status !== 201) {
      throw new MomoError(
        `Could not create the MoMo sandbox user (${created.status}): ${await this.reason(created)}`,
      );
    }
    const keyRes = await fetch(`${this.env.MOMO_BASE_URL}/v1_0/apiuser/${user}/apikey`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': subscription },
      signal: AbortSignal.timeout(20_000),
    });
    if (keyRes.status !== 201) {
      throw new MomoError(`Could not create the MoMo sandbox key (${keyRes.status})`);
    }
    const { apiKey } = (await keyRes.json()) as { apiKey: string };
    const value = { user, key: apiKey };
    await this.prisma.providerCredential.upsert({
      where: { key: name },
      update: { valueEnc: this.crypto.encrypt(JSON.stringify(value)) },
      create: { key: name, valueEnc: this.crypto.encrypt(JSON.stringify(value)) },
    });
    this.logger.log(`Provisioned a MoMo sandbox API user for ${product}`);
    return value;
  }

  /** A short reason from an error response, never the full body (it can echo our request). */
  private async reason(res: Response): Promise<string> {
    try {
      const body = (await res.json()) as { message?: string; code?: string };
      return (body.message ?? body.code ?? res.statusText).slice(0, 200);
    } catch {
      return res.statusText;
    }
  }
}
