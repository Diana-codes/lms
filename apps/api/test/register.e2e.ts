import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { legacyTerms, REGISTRATION_CONSENT_VERSION } from '@kora/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import type { PrismaClient } from '../src/generated/prisma/client';
import { signInWithSms, smsTwoFactor } from './sign-in';
import { testPrisma } from './test-db';

/** Signing up in the borrower app, and staff taking on the new customer. */
const PASSWORD = `e2e-${randomUUID()}`;
const BRANCH = `E2ER-${randomUUID().slice(0, 6)}`;

let app: INestApplication;
let prisma: PrismaClient;
let branchId = '';
const cookies: Record<'officer' | 'other' | 'manager', string[]> = {
  officer: [],
  other: [],
  manager: [],
};
const ids: Record<'officer' | 'other' | 'manager', string> = {
  officer: '',
  other: '',
  manager: '',
};

const http = () => request(app.getHttpServer());
const phone = () => `078${randomInt(1_000_000, 9_999_999)}`;
const e164 = (n: string) => `+250${n.slice(1)}`;
/** A national ID for someone born in 1990, unique per call. */
const nationalId = (year = 1990) => `1${year}8${String(randomInt(0, 1e10)).padStart(10, '0')}`;
/** Each test gets its own IP, so the per-IP sign-up limit never spills between tests. */
const ip = () => `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;

/** The code is never stored; find it by matching the hash, as a test-only shortcut. */
async function codeFor(number: string): Promise<string> {
  const challenge = await prisma.otpChallenge.findFirstOrThrow({
    where: { phone: e164(number) },
    orderBy: { createdAt: 'desc' },
  });
  for (let i = 0; i < 1_000_000; i++) {
    const c = String(i).padStart(6, '0');
    if (
      createHash('sha256')
        .update(`${e164(number)}:${c}`)
        .digest('base64url') === challenge.codeHash
    )
      return c;
  }
  throw new Error('code not found');
}

/** Request and check a code for a new number; returns the sign-up token. */
async function proveNumber(number: string, from = ip()): Promise<string> {
  await http()
    .post('/app/auth/request-code')
    .set('X-Forwarded-For', from)
    .send({ phone: number })
    .expect(200);
  const res = await http()
    .post('/app/auth/verify')
    .send({ phone: number, code: await codeFor(number) })
    .expect(200);
  expect(res.body.accessToken).toBeUndefined();
  return res.body.registrationToken as string;
}

const details = (registrationToken: string, id = nationalId()) => ({
  registrationToken,
  fullName: '  Grace   Mukamana ',
  nationalId: id,
  businessName: 'Grace Tailoring',
  businessSector: 'Garments & tailoring',
  branchCode: BRANCH,
  agreedTerms: true,
  agreedDataProcessing: true,
  marketingSms: false,
  consentVersion: REGISTRATION_CONSENT_VERSION,
});

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  prisma = testPrisma();
  branchId = (
    await prisma.branch.create({
      data: { code: BRANCH, name: `E2E ${BRANCH}`, district: 'Gasabo' },
    })
  ).id;
  const hash = await hashPassword(PASSWORD);
  for (const [who, role] of [
    ['officer', 'LOAN_OFFICER'],
    ['other', 'LOAN_OFFICER'],
    ['manager', 'MANAGER'],
  ] as const) {
    const email = `e2e-reg-${who}-${randomUUID()}@koralend.test`;
    const factor = smsTwoFactor();
    ids[who] = (
      await prisma.user.create({
        data: {
          email,
          passwordHash: hash,
          firstName: 'E2E',
          lastName: who,
          role,
          branchId,
          ...factor,
        },
      })
    ).id;
    const res = await signInWithSms(app, { email, phone: factor.phone }, PASSWORD);
    cookies[who] = ([] as string[])
      .concat(res.get('Set-Cookie') ?? [])
      .map((c) => c.split(';')[0]!);
  }
});

afterAll(async () => {
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-reg-' } },
    data: { isActive: false },
  });
  await app.close();
  await prisma.$disconnect();
});

describe('signing up in the app', () => {
  it('texts a code to a new number and returns a sign-up token, not a session', async () => {
    const number = phone();
    const token = await proveNumber(number);
    expect(token).toBeTruthy();
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { phone: e164(number) },
    });
    expect(challenge.signup).toBe(true);
    // A sign-up token is not an access token.
    await http().get('/app/home').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('lists branches, sectors and the privacy notice', async () => {
    const res = await http().get('/app/auth/register').expect(200);
    expect(res.body.branches.map((b: { code: string }) => b.code)).toContain(BRANCH);
    expect(res.body.sectors).toContain('Retail shop');
    expect(res.body.consentVersion).toBe(REGISTRATION_CONSENT_VERSION);
    expect(res.body.privacy.length).toBeGreaterThan(0);
  });

  it('opens an unverified account with consents, encrypted ID and no officer', async () => {
    const number = phone();
    const id = nationalId();
    const token = await proveNumber(number);
    const res = await http()
      .post('/app/auth/register')
      .send({ ...details(token, id), marketingSms: true })
      .expect(201);
    expect(res.body.accessToken).toBeTruthy();

    const home = await http()
      .get('/app/home')
      .set('Authorization', `Bearer ${res.body.accessToken}`)
      .expect(200);
    expect(home.body.firstName).toBe('Grace');
    expect(home.body.loan).toBeNull();

    const b = await prisma.borrower.findFirstOrThrow({
      where: { phone: e164(number) },
      include: { business: true, consents: true },
    });
    expect(b.fullName).toBe('Grace Mukamana');
    expect(b.source).toBe('APP');
    expect(b.kycStatus).toBe('PENDING');
    expect(b.officerId).toBeNull();
    expect(b.branchId).toBe(branchId);
    expect(b.nationalIdEnc).not.toContain(id);
    expect(b.nationalIdLast3).toBe(id.slice(-3));
    expect(b.business?.name).toBe('Grace Tailoring');
    expect(b.consents.map((c) => c.type).sort()).toEqual([
      'DATA_PROCESSING',
      'MARKETING_SMS',
      'TERMS',
    ]);
    expect(b.consents.every((c) => c.textVersion === REGISTRATION_CONSENT_VERSION)).toBe(true);

    const note = await prisma.notification.findFirst({
      where: { userId: ids.manager, href: `/borrowers/${b.code}` },
    });
    expect(note?.title).toContain('needs an officer');
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'borrower.register', entityId: b.code },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain(number.slice(1, 7));

    // The same token cannot open a second account.
    await http().post('/app/auth/register').send(details(token)).expect(409);
    // Next time the number signs in normally.
    await http().post('/app/auth/request-code').send({ phone: number }).expect(200);
    const again = await http()
      .post('/app/auth/verify')
      .send({ phone: number, code: await codeFor(number) })
      .expect(200);
    expect(again.body.accessToken).toBeTruthy();
  });

  it('refuses an ID number that is already registered, and tells the managers', async () => {
    const id = nationalId();
    await http()
      .post('/app/auth/register')
      .send(details(await proveNumber(phone()), id))
      .expect(201);
    const first = await prisma.borrower.findFirstOrThrow({
      where: { nationalIdLast3: id.slice(-3), branchId },
      orderBy: { createdAt: 'desc' },
    });
    const res = await http()
      .post('/app/auth/register')
      .send(details(await proveNumber(phone()), id))
      .expect(409);
    expect(res.body.message).toContain('already registered');
    expect(
      await prisma.auditLog.count({
        where: { action: 'borrower.register.duplicate_id', entityId: first.code },
      }),
    ).toBe(1);
    expect(
      await prisma.notification.count({
        where: { userId: ids.manager, title: { contains: `ID number of ${first.code}` } },
      }),
    ).toBe(1);
  });

  it('checks age, consent, the branch and the token', async () => {
    const token = await proveNumber(phone());
    const under18 = nationalId(new Date().getFullYear() - 16);
    const young = await http().post('/app/auth/register').send(details(token, under18)).expect(400);
    expect(young.body.message).toContain('18');
    await http()
      .post('/app/auth/register')
      .send({ ...details(token), agreedDataProcessing: false })
      .expect(400);
    await http()
      .post('/app/auth/register')
      .send({ ...details(token), branchCode: 'NOPE' })
      .expect(400);
    await http()
      .post('/app/auth/register')
      .send({ ...details(token), consentVersion: 'old' })
      .expect(409);
    await http()
      .post('/app/auth/register')
      .send({ ...details(token), fullName: 'Grace' })
      .expect(400);
    await http()
      .post('/app/auth/register')
      .send({ ...details(token), nationalId: '4199080012345012' })
      .expect(400);
    await http().post('/app/auth/register').send(details('not-a-token')).expect(401);
  });

  it('limits sign-up codes per IP address', async () => {
    const from = ip();
    for (let i = 0; i < 20; i++)
      await http()
        .post('/app/auth/request-code')
        .set('X-Forwarded-For', from)
        .send({ phone: phone() })
        .expect(200);
    await http()
      .post('/app/auth/request-code')
      .set('X-Forwarded-For', from)
      .send({ phone: phone() })
      .expect(429);
    // Another IP is unaffected.
    await http()
      .post('/app/auth/request-code')
      .set('X-Forwarded-For', ip())
      .send({ phone: phone() })
      .expect(200);
  });
});

describe('taking on a new customer', () => {
  async function newCustomer(): Promise<string> {
    const number = phone();
    await http()
      .post('/app/auth/register')
      .send(details(await proveNumber(number)))
      .expect(201);
    return (await prisma.borrower.findFirstOrThrow({ where: { phone: e164(number) } })).code;
  }

  it('shows customers without an officer, and an officer can take one', async () => {
    const code = await newCustomer();
    const list = await http()
      .get('/borrowers?unassigned=true&q=Grace')
      .set('Cookie', cookies.officer)
      .expect(200);
    const row = list.body.items.find((i: { code: string }) => i.code === code);
    expect(row).toMatchObject({ source: 'APP', officerName: null });

    const profile = await http().get(`/borrowers/${code}`).set('Cookie', cookies.officer);
    expect(profile.body.tags.map((t: { label: string }) => t.label)).toContain(
      'Signed up in the app',
    );

    await http()
      .post(`/borrowers/${code}/officer`)
      .set('Cookie', cookies.officer)
      .send({})
      .expect(200);
    const b = await prisma.borrower.findFirstOrThrow({ where: { code } });
    expect(b.officerId).toBe(ids.officer);
    // Another officer cannot take them away, or assign someone else.
    await http()
      .post(`/borrowers/${code}/officer`)
      .set('Cookie', cookies.other)
      .send({})
      .expect(403);
    await http()
      .post(`/borrowers/${code}/officer`)
      .set('Cookie', cookies.other)
      .send({ officerId: ids.other })
      .expect(403);
    expect(
      await prisma.auditLog.count({ where: { action: 'borrower.officer.assign', entityId: code } }),
    ).toBe(1);
  });

  it('lets a manager move the customer, with open applications', async () => {
    const code = await newCustomer();
    const b = await prisma.borrower.findFirstOrThrow({ where: { code } });
    await http()
      .post(`/borrowers/${code}/officer`)
      .set('Cookie', cookies.officer)
      .send({})
      .expect(200);
    const product = await prisma.product.create({
      data: {
        code: `E2ER-${randomUUID().slice(0, 8)}`,
        name: 'E2E sign-up product',
        shortName: 'E2E',
        kind: 'SME',
        terms: legacyTerms(1700) as object,
        annualRateBps: 1700,
        minTermMonths: 6,
        maxTermMonths: 24,
        minAmount: 500_000n,
        maxAmount: 6_000_000n,
        status: 'RETIRED',
      },
    });
    const application = await prisma.application.create({
      data: {
        code: `APP-E2E${randomInt(100000, 999999)}`,
        borrowerId: b.id,
        productId: product.id,
        amount: product.minAmount,
        termMonths: product.minTermMonths,
        annualRateBps: product.annualRateBps,
        officerId: ids.officer,
        channel: 'APP',
      },
    });
    await http()
      .post(`/borrowers/${code}/officer`)
      .set('Cookie', cookies.manager)
      .send({ officerId: ids.other })
      .expect(200);
    expect((await prisma.borrower.findFirstOrThrow({ where: { code } })).officerId).toBe(ids.other);
    expect(
      (await prisma.application.findUniqueOrThrow({ where: { id: application.id } })).officerId,
    ).toBe(ids.other);
    expect(
      await prisma.notification.count({ where: { userId: ids.other, href: `/borrowers/${code}` } }),
    ).toBe(1);
    await http()
      .post(`/borrowers/${code}/officer`)
      .set('Cookie', cookies.manager)
      .send({ officerId: randomUUID() })
      .expect(400);
  });
});
