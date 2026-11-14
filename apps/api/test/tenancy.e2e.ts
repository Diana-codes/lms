import { legacyTerms } from '@kora/core';
import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiService } from '../src/ai/ai.service';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import { generateTotpSecret, totpCode, totpStep } from '../src/auth/totp';
import { PiiCrypto } from '../src/common/pii-crypto';
import { PrismaClient } from '../src/generated/prisma/client';
import { ACCOUNTS } from '../src/ledger/accounts';
import { ProvidersService } from '../src/providers/providers.service';
import { runAsCompany } from '../src/tenancy/company-context';
import { lastCodeTo, signInWithSms, smsTwoFactor, testPhone } from './sign-in';
import { testPrisma } from './test-db';

/**
 * Company isolation, end to end. Two companies are created through the
 * platform API, each with data, and every layer is checked: the API, the
 * database login itself, the reporting views, webhooks, suspension and the
 * optional features.
 */
const run = randomUUID().slice(0, 6);
const PLATFORM_EMAIL = `platform-${run}@orintech.test`;
const PLATFORM_PASSWORD = `platform-${randomUUID()}`;
const PLATFORM_TOTP = generateTotpSecret();
const SHARED_EMAIL = `admin-${run}@lender.test`;
const PASSWORD = { a: `alpha-${randomUUID()}`, b: `beta-${randomUUID()}` };

let app: INestApplication;
let owner: PrismaClient;
let platformCookie: string[];

type Company = {
  id: string;
  slug: string;
  cookies: string[];
  webhookToken: string;
  db: PrismaClient;
};
const co = {} as Record<'a' | 'b', Company>;

const http = () => request(app.getHttpServer());
const cookiesOf = (res: request.Response): string[] =>
  ([] as string[]).concat(res.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]!);
const as = (c: Company) => ({
  get: (path: string) => http().get(path).set('x-company', c.slug).set('Cookie', c.cookies),
  post: (path: string, body: object = {}) =>
    http().post(path).set('x-company', c.slug).set('Cookie', c.cookies).send(body),
});
const phone = () => `078${randomInt(1_000_000, 9_999_999)}`;

async function createCompany(key: 'a' | 'b', aiFeatures = false): Promise<Company> {
  const slug = `${key === 'a' ? 'alpha' : 'beta'}-${run}`;
  const res = await http()
    .post('/platform/companies')
    .set('Cookie', platformCookie)
    .send({
      slug,
      name: key === 'a' ? 'Alpha Lending' : 'Beta Credit',
      aiFeatures,
      // The same email at both lenders: accounts are per company.
      admin: {
        email: SHARED_EMAIL,
        firstName: 'Ada',
        lastName: key.toUpperCase(),
        password: PASSWORD[key],
      },
    })
    .expect(201);
  const id = res.body.company.id as string;
  const login = await http()
    .post('/auth/login')
    .set('x-company', slug)
    .send({ email: SHARED_EMAIL, password: PASSWORD[key] })
    .expect(200);
  // The platform admin chose this password, so the company admin replaces it first.
  expect(login.body.user.mustChangePassword).toBe(true);
  await http()
    .get('/applications')
    .set('x-company', slug)
    .set('Cookie', cookiesOf(login))
    .expect(403);
  await http()
    .post('/auth/password')
    .set('x-company', slug)
    .set('Cookie', cookiesOf(login))
    .set('Origin', process.env.WEB_ORIGIN ?? 'http://localhost:3000')
    .send({ currentPassword: PASSWORD[key], newPassword: `${PASSWORD[key]}-own` })
    .expect(204);
  // Then two-factor, which is required: texted codes on a confirmed phone.
  const adminPhone = testPhone();
  const asAdmin = (path: string) =>
    http()
      .post(path)
      .set('x-company', slug)
      .set('Cookie', cookiesOf(login))
      .set('Origin', process.env.WEB_ORIGIN ?? 'http://localhost:3000');
  await asAdmin('/auth/2fa/sms/start').send({ phone: adminPhone }).expect(200);
  await asAdmin('/auth/2fa/sms/confirm')
    .send({ code: lastCodeTo(app, adminPhone) })
    .expect(200);
  const db = testPrisma(id);
  await db.product.create({
    data: {
      code: `T-${run}`,
      name: 'Tenancy test loan',
      shortName: 'Test',
      kind: 'SME',
      terms: legacyTerms(1800) as object,
      annualRateBps: 1800,
      minTermMonths: 3,
      maxTermMonths: 24,
      minAmount: 100_000n,
      maxAmount: 10_000_000n,
    },
  });
  return { id, slug, cookies: cookiesOf(login), webhookToken: res.body.webhookToken, db };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  owner = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  // A platform admin with two-factor already on (setting it up is tested below).
  const crypto = app.get(PiiCrypto);
  await owner.platformAdmin.create({
    data: {
      email: PLATFORM_EMAIL,
      name: 'Test platform admin',
      passwordHash: await hashPassword(PLATFORM_PASSWORD),
      totpSecretEnc: crypto.encrypt(PLATFORM_TOTP),
      totpEnabledAt: new Date(),
    },
  });
  const first = await http()
    .post('/platform/auth/login')
    .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASSWORD })
    .expect(200);
  expect(first.body).toMatchObject({ status: 'TWO_FACTOR_REQUIRED', method: 'app' });
  expect(first.get('Set-Cookie')).toBeUndefined();
  const res = await http()
    .post('/platform/auth/2fa/verify')
    .send({ challengeToken: first.body.challengeToken, code: totpCode(PLATFORM_TOTP, totpStep()) })
    .expect(200);
  platformCookie = cookiesOf(res);
  co.a = await createCompany('a');
  co.b = await createCompany('b');
});

afterAll(async () => {
  await owner.company.updateMany({
    where: { id: { in: [co.a?.id, co.b?.id].filter(Boolean) as string[] } },
    data: { status: 'SUSPENDED' },
  });
  await owner.platformAdmin.updateMany({
    where: { email: PLATFORM_EMAIL },
    data: { isActive: false },
  });
  await Promise.all([owner.$disconnect(), co.a?.db.$disconnect(), co.b?.db.$disconnect()]);
  await app.close();
});

describe('platform administration', () => {
  it('needs a platform session, which staff sessions are not', async () => {
    await http().get('/platform/companies').expect(401);
    await http().get('/platform/companies').set('Cookie', co.a.cookies).expect(401);
    await http()
      .post('/platform/auth/login')
      .send({ email: PLATFORM_EMAIL, password: 'wrong-password-here' })
      .expect(401);
    const list = await http().get('/platform/companies').set('Cookie', platformCookie).expect(200);
    expect(list.body.map((c: { slug: string }) => c.slug)).toEqual(
      expect.arrayContaining([co.a.slug, co.b.slug]),
    );
  });

  it('requires two-factor: a new admin can only set it up, then signs in with a code', async () => {
    const email = `new-platform-${run}@orintech.test`;
    const password = `platform-${randomUUID()}`;
    await owner.platformAdmin.create({
      data: { email, name: 'New admin', passwordHash: await hashPassword(password) },
    });
    const login = await http().post('/platform/auth/login').send({ email, password }).expect(200);
    expect(login.body).toMatchObject({ status: 'OK', admin: { twoFactorEnabled: false } });
    const cookie = cookiesOf(login);
    // Nothing but the setup works yet.
    await http().get('/platform/companies').set('Cookie', cookie).expect(403);
    const setup = await http().post('/platform/auth/2fa/setup').set('Cookie', cookie).expect(200);
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/');
    await http()
      .post('/platform/auth/2fa/enable')
      .set('Cookie', cookie)
      .send({ code: '000000' })
      .expect(400);
    await http()
      .post('/platform/auth/2fa/enable')
      .set('Cookie', cookie)
      .send({ code: totpCode(setup.body.secret, totpStep()) })
      .expect(204);
    await http().get('/platform/companies').set('Cookie', cookie).expect(200);
    // From now on the password alone is not enough.
    const again = await http().post('/platform/auth/login').send({ email, password }).expect(200);
    expect(again.body).toMatchObject({ status: 'TWO_FACTOR_REQUIRED', method: 'app' });
    await http()
      .post('/platform/auth/2fa/verify')
      .send({ challengeToken: again.body.challengeToken, code: '123456' })
      .expect(401);
    await owner.platformAdmin.updateMany({ where: { email }, data: { isActive: false } });
  });

  it('platform admins can use texted codes instead', async () => {
    const email = `sms-platform-${run}@orintech.test`;
    const password = `platform-${randomUUID()}`;
    await owner.platformAdmin.create({
      data: { email, name: 'SMS admin', passwordHash: await hashPassword(password) },
    });
    const cookie = cookiesOf(
      await http().post('/platform/auth/login').send({ email, password }).expect(200),
    );
    const adminPhone = testPhone();
    await http()
      .post('/platform/auth/2fa/sms/start')
      .set('Cookie', cookie)
      .send({ phone: adminPhone })
      .expect(200);
    const confirmed = await http()
      .post('/platform/auth/2fa/sms/confirm')
      .set('Cookie', cookie)
      .send({ code: lastCodeTo(app, adminPhone) })
      .expect(200);
    expect(confirmed.body).toMatchObject({ twoFactorEnabled: true, twoFactorMethod: 'sms' });
    await http().get('/platform/companies').set('Cookie', cookie).expect(200);

    const next = await http().post('/platform/auth/login').send({ email, password }).expect(200);
    expect(next.body).toMatchObject({ status: 'TWO_FACTOR_REQUIRED', method: 'sms' });
    // The message names the platform, not a lender.
    const outbox = app.get(ProvidersService).platformSmsSimulator.outbox;
    expect(outbox.at(-1)!.message).toMatch(/^Kora Lend platform: your sign-in code is \d{6}\./);
    await http()
      .post('/platform/auth/2fa/verify')
      .send({ challengeToken: next.body.challengeToken, code: lastCodeTo(app, adminPhone) })
      .expect(200);
    // Platform codes are out of reach of the company database login.
    await expect(co.a.db.$queryRawUnsafe('SELECT count(*) FROM "PlatformCode"')).rejects.toThrow(
      /permission denied/,
    );
    await owner.platformAdmin.updateMany({ where: { email }, data: { isActive: false } });
  });

  it('refuses reserved or taken addresses', async () => {
    const body = (slug: string) => ({
      slug,
      name: 'Nope',
      admin: { email: 'x@y.test', firstName: 'X', lastName: 'Y', password: 'long-enough-password' },
    });
    await http()
      .post('/platform/companies')
      .set('Cookie', platformCookie)
      .send(body('admin'))
      .expect(400);
    await http()
      .post('/platform/companies')
      .set('Cookie', platformCookie)
      .send(body(co.a.slug))
      .expect(409);
  });

  it('gives each new company its own chart of accounts', async () => {
    const accounts = await owner.ledgerAccount.groupBy({
      by: ['companyId'],
      where: { companyId: { in: [co.a.id, co.b.id] } },
      _count: true,
    });
    const chart = Object.keys(ACCOUNTS).length;
    expect(accounts.map((a) => a._count)).toEqual([chart, chart]);
  });
});

describe('isolation through the API', () => {
  it('a session only works at its own company', async () => {
    await as(co.a).get('/auth/me').expect(200);
    // Company A's cookies presented at company B.
    await http()
      .get('/auth/me')
      .set('x-company', co.b.slug)
      .set('Cookie', co.a.cookies)
      .expect(401);
    // The shared email signs in to each company with that company's own password only.
    await http()
      .post('/auth/login')
      .set('x-company', co.b.slug)
      .send({ email: SHARED_EMAIL, password: PASSWORD.a })
      .expect(401);
  });

  it("one company never sees another's applications, borrowers or loans", async () => {
    const samePhone = phone();
    const created = await as(co.a)
      .post('/applications', {
        name: 'Isolation Test',
        phone: samePhone,
        productCode: `T-${run}`,
        amount: '500000',
        termMonths: 6,
      })
      .expect(201);
    // The same person can borrow from both lenders.
    const other = await as(co.b)
      .post('/applications', {
        name: 'Isolation Test',
        phone: samePhone,
        productCode: `T-${run}`,
        amount: '700000',
        termMonths: 6,
      })
      .expect(201);
    // Reference numbers run per company.
    expect(created.body.code).toBe(other.body.code);

    await as(co.b).get(`/borrowers/${created.body.borrowerCode}`).expect(200); // B's own BR- of the same number
    const bApp = (await as(co.b).get(`/applications/${created.body.code}`).expect(200)).body;
    expect(bApp.amount).toBe('700000');

    const bList = (await as(co.b).get('/borrowers').expect(200)).body;
    const bRows = JSON.stringify(bList);
    expect(bRows).not.toContain('500000');
  });
});

describe('isolation in the database', () => {
  it('every table with a companyId has row-level security and a policy', async () => {
    const rows = await owner.$queryRaw<Array<{ table: string; rls: boolean; policies: bigint }>>`
      SELECT c.relname AS table, c.relrowsecurity AS rls,
             (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'companyId')`;
    expect(rows.length).toBeGreaterThanOrEqual(35);
    expect(rows.filter((r) => !r.rls || r.policies < 1n).map((r) => r.table)).toEqual([]);
  });

  it("the company login cannot read another company's rows, in any table", async () => {
    const tables = await owner.$queryRaw<Array<{ table: string }>>`
      SELECT table_name AS table FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'companyId'`;
    for (const { table } of tables) {
      const rows = await co.b.db.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*) AS n FROM "${table}" WHERE "companyId" = $1::uuid`,
        co.a.id,
      );
      expect(rows[0]?.n, table).toBe(0n);
    }
  });

  it('the company login cannot write into another company', async () => {
    const product = await co.a.db.product.findFirstOrThrow({ where: { code: `T-${run}` } });
    await expect(
      co.b.db
        .$executeRaw`UPDATE "Product" SET "name" = 'hijacked' WHERE "id" = ${product.id}::uuid`,
    ).resolves.toBe(0);
    await expect(
      co.b.db.$executeRaw`INSERT INTO "Branch" ("id", "companyId", "code", "name", "district")
        VALUES (gen_random_uuid(), ${co.a.id}::uuid, 'X', 'X', 'X')`,
    ).rejects.toThrow(/row-level security/);
    expect((await co.a.db.product.findFirstOrThrow({ where: { id: product.id } })).name).not.toBe(
      'hijacked',
    );
  });

  it('with no company set, the company login sees nothing', async () => {
    const none = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.APP_DATABASE_URL! }),
    });
    try {
      expect(await none.loan.count()).toBe(0);
      expect(await none.user.count()).toBe(0);
      await expect(none.platformAdmin.count()).rejects.toThrow(/permission denied/);
    } finally {
      await none.$disconnect();
    }
  });

  it('reporting views only show the company asking', async () => {
    if (!process.env.REPORTING_DATABASE_URL) return;
    const ai = app.get(AiService);
    const count = (id: string) =>
      runAsCompany(id, () => ai.run('SELECT count(*)::int AS n FROM applications'));
    const [a] = await count(co.a.id);
    const [b] = await count(co.b.id);
    expect(a).toEqual({ n: await co.a.db.application.count() });
    expect(b).toEqual({ n: await co.b.db.application.count() });
  });
});

describe('webhooks', () => {
  it("a company's webhook secret only works for that company", async () => {
    await http().post(`/webhooks/momo/collection/${co.a.webhookToken}`).send({}).expect(200);
    await http()
      .post(`/webhooks/momo/collection/${randomUUID()}${randomUUID()}`)
      .send({})
      .expect(401);
    expect(co.a.webhookToken).not.toBe(co.b.webhookToken);
  });
});

describe('features and suspension', () => {
  it('optional features are off for a new company', async () => {
    const status = (await as(co.a).get('/ai/status').expect(200)).body;
    expect(status.configured).toBe(false);
    await as(co.a).post('/applications/auto-approve').expect(403);
    const profile = (await http().get('/company').set('x-company', co.a.slug).expect(200)).body;
    expect(profile).toMatchObject({ slug: co.a.slug, features: { ai: false, autoApprove: false } });
  });

  it('a suspended company is locked out, and the other is not affected', async () => {
    await http()
      .patch(`/platform/companies/${co.b.id}`)
      .set('Cookie', platformCookie)
      .send({ status: 'SUSPENDED' })
      .expect(200);
    await as(co.b).get('/auth/me').expect(403);
    await as(co.a).get('/auth/me').expect(200);
    await http()
      .patch(`/platform/companies/${co.b.id}`)
      .set('Cookie', platformCookie)
      .send({ status: 'ACTIVE' })
      .expect(200);
    await as(co.b).get('/auth/me').expect(200);
  });

  it('records every platform action in the audit log', async () => {
    const actions = await owner.auditLog.findMany({
      where: { actorType: 'PLATFORM', companyId: co.b.id },
      select: { action: true },
    });
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining(['platform.company.create', 'platform.company.update']),
    );
  });
});

describe("a company's own settings", () => {
  const send = (c: Company, method: 'patch' | 'put' | 'post', path: string, body: object = {}) =>
    http()[method](path).set('x-company', c.slug).set('Cookie', c.cookies).send(body);

  it('its admin sees them, with secrets only marked as set', async () => {
    const res = await as(co.b).get('/company/settings').expect(200);
    expect(res.body).toMatchObject({
      slug: co.b.slug,
      webhookConfigured: true,
      features: { ai: false, autoApprove: false },
    });
    expect(JSON.stringify(res.body)).not.toContain(co.b.webhookToken);
  });

  it('its admin changes the branding, and nothing the platform controls', async () => {
    await send(co.b, 'patch', '/company/settings', {
      brandName: 'Beta Money',
      brandColor: '#123456',
      logoUrl: 'https://example.com/logo.png',
    }).expect(200);
    const profile = (await http().get('/company').set('x-company', co.b.slug).expect(200)).body;
    expect(profile).toMatchObject({ displayName: 'Beta Money', brandColor: '#123456' });

    for (const body of [{ status: 'SUSPENDED' }, { aiFeatures: true }, { name: 'Renamed' }]) {
      await send(co.b, 'patch', '/company/settings', body).expect(400);
    }
    await send(co.b, 'patch', '/company/settings', { logoUrl: 'http://example.com/a.png' }).expect(
      400,
    );
    // The database refuses too: the company login may only change branding columns.
    await expect(
      co.b.db.company.update({ where: { id: co.b.id }, data: { aiFeatures: true } }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      co.b.db.company.update({ where: { id: co.a.id }, data: { brandName: 'Hijacked' } }),
    ).rejects.toThrow();
    const a = await owner.company.findUniqueOrThrow({ where: { id: co.a.id } });
    expect(a.brandName).not.toBe('Hijacked');
  });

  it('only its admins can change them', async () => {
    const factor = smsTwoFactor();
    const email = `officer-${run}@lender.test`;
    await co.b.db.user.create({
      data: {
        email,
        passwordHash: await hashPassword(PASSWORD.b),
        firstName: 'Olive',
        lastName: 'Officer',
        role: 'LOAN_OFFICER',
        ...factor,
      },
    });
    const session = await signInWithSms(app, { email, phone: factor.phone }, PASSWORD.b, co.b.slug);
    const cookies = cookiesOf(session);
    await http()
      .get('/company/settings')
      .set('x-company', co.b.slug)
      .set('Cookie', cookies)
      .expect(403);
    await http()
      .post('/company/settings/webhook-token')
      .set('x-company', co.b.slug)
      .set('Cookie', cookies)
      .expect(403);
  });

  it('its admin sets provider keys (write-only) and issues a new webhook secret', async () => {
    const secrets = await send(co.b, 'put', '/company/settings/secrets', {
      smsUsername: 'beta-at',
      smsApiKey: 'at-secret-key',
    }).expect(200);
    expect(secrets.body).toMatchObject({ 'sms.username': true, 'sms.api_key': true });
    expect(JSON.stringify(secrets.body)).not.toContain('at-secret-key');
    await send(co.b, 'put', '/company/settings/secrets', { smsApiKey: null }).expect(200);
    const after = (await as(co.b).get('/company/settings').expect(200)).body;
    expect(after.secrets['sms.api_key']).toBe(false);

    const rotated = await send(co.b, 'post', '/company/settings/webhook-token').expect(200);
    const token: string = rotated.body.webhookToken;
    expect(token).not.toBe(co.b.webhookToken);
    expect(rotated.body.urls.smsDelivery).toMatch(new RegExp(`/webhooks/sms/delivery/${token}$`));
    await http().post(`/webhooks/momo/collection/${co.b.webhookToken}`).send({}).expect(401);
    await http().post(`/webhooks/momo/collection/${token}`).send({}).expect(200);

    const actions = await owner.auditLog.findMany({
      where: { companyId: co.b.id, action: { startsWith: 'company.settings.' } },
      select: { action: true, metadata: true },
    });
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        'company.settings.update',
        'company.settings.secrets',
        'company.settings.webhook_rotate',
      ]),
    );
    expect(JSON.stringify(actions)).not.toContain('at-secret-key');
  });
});
