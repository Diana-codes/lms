import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { kigaliDate, legacyTerms } from '@kora/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import type { PrismaClient, StaffRole } from '../src/generated/prisma/client';
import { ACCOUNTS } from '../src/ledger/accounts';
import { CompaniesService } from '../src/tenancy/companies.service';
import { signInWithSms, smsTwoFactor } from './sign-in';
import { byCode, E2E_COMPANY_ID, testPrisma } from './test-db';

/** PRD §3.3–3.5: the extra staff roles and segregation of duties. */
const PASSWORD = `e2e-${randomUUID()}`;
const PRODUCT = `E2R-${randomUUID().slice(0, 8)}`;
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

let app: INestApplication;
let prisma: PrismaClient;
type Agent = { cookies: string[]; id: string };
const staff = {} as Record<'analyst' | 'accountant' | 'auditor' | 'manager' | 'manager2', Agent>;

const http = () => request(app.getHttpServer());
const get = (who: Agent, path: string) => http().get(path).set('Cookie', who.cookies);
const post = (who: Agent, path: string, body: object = {}) =>
  http().post(path).set('Cookie', who.cookies).set('Origin', ORIGIN).send(body);

async function signIn(role: StaffRole, passwordHash: string): Promise<Agent> {
  const email = `e2e-roles-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
  const factor = smsTwoFactor();
  const user = await prisma.user.create({
    data: { email, passwordHash, firstName: 'E2E', lastName: role, role, ...factor },
  });
  const res = await signInWithSms(app, { email, phone: factor.phone }, PASSWORD);
  const cookies = ([] as string[]).concat(res.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]!);
  return { cookies, id: user.id };
}

async function approvedApplication(by: Agent) {
  const created = await post(by, '/applications', {
    name: `E2E Roles ${randomUUID().slice(0, 6)}`,
    phone: `078${randomInt(1_000_000, 9_999_999)}`,
    productCode: PRODUCT,
    amount: '800000',
    termMonths: 6,
  }).expect(201);
  const code = created.body.code as string;
  await post(by, `/applications/${code}/move`, { to: 'UNDER_REVIEW' }).expect(200);
  await post(staff.manager, `/applications/${code}/approve`).expect(200);
  await post(staff.manager, `/applications/${code}/agreement`).expect(200);
  return code;
}

async function setStrict(on: boolean) {
  await prisma.company.update({ where: { id: E2E_COMPANY_ID }, data: { strictSegregation: on } });
  app.get(CompaniesService).invalidate();
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  prisma = testPrisma();
  for (const account of Object.values(ACCOUNTS)) {
    await prisma.ledgerAccount.upsert({
      where: byCode(account.code),
      update: {},
      create: { ...account, companyId: E2E_COMPANY_ID },
    });
  }
  await prisma.product.create({
    data: {
      code: PRODUCT,
      name: 'E2E roles product',
      shortName: 'Roles',
      kind: 'SME',
      terms: legacyTerms(1800) as object,
      annualRateBps: 1800,
      minTermMonths: 3,
      maxTermMonths: 24,
      minAmount: 100_000n,
      maxAmount: 10_000_000n,
    },
  });
  const hash = await hashPassword(PASSWORD);
  staff.analyst = await signIn('CREDIT_ANALYST', hash);
  staff.accountant = await signIn('ACCOUNTANT', hash);
  staff.auditor = await signIn('AUDITOR', hash);
  staff.manager = await signIn('MANAGER', hash);
  staff.manager2 = await signIn('MANAGER', hash);
});

afterAll(async () => {
  await setStrict(false);
  await prisma.product.updateMany({ where: { code: PRODUCT }, data: { status: 'RETIRED' } });
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-roles-' } },
    data: { isActive: false },
  });
  await app.close();
  await prisma.$disconnect();
});

describe('credit analysts', () => {
  it('take and assess applications, but cannot approve them', async () => {
    const created = await post(staff.analyst, '/applications', {
      name: 'E2E Analyst Applicant',
      phone: `078${randomInt(1_000_000, 9_999_999)}`,
      productCode: PRODUCT,
      amount: '500000',
      termMonths: 6,
    }).expect(201);
    await post(staff.analyst, `/applications/${created.body.code}/move`, {
      to: 'UNDER_REVIEW',
    }).expect(200);
    await post(staff.analyst, `/applications/${created.body.code}/disburse`, {
      channel: 'BANK_TRANSFER',
    }).expect(403);
  });
});

describe('auditors', () => {
  it('can read loans, reports and the audit log', async () => {
    await get(staff.auditor, '/loans').expect(200);
    await get(staff.auditor, '/applications').expect(200);
    await get(staff.auditor, '/reports').expect(200);
    const log = await get(staff.auditor, '/audit-logs?action=auth.').expect(200);
    expect(log.body.items.length).toBeGreaterThan(0);
    expect(log.body.items[0]).toMatchObject({ action: expect.stringMatching(/^auth\./) });
  });

  it('cannot change anything, but can still manage their own sign-in', async () => {
    const res = await post(staff.auditor, '/applications', {
      name: 'Nope',
      phone: `078${randomInt(1_000_000, 9_999_999)}`,
      productCode: PRODUCT,
      amount: '500000',
      termMonths: 6,
    }).expect(403);
    expect(res.body.message).toBe('Your role has read-only access');
    await post(staff.auditor, '/sms/reminders').expect(403);
    await post(staff.auditor, '/auth/logout').expect((r) => expect(r.status).toBeLessThan(400));
  });

  it('the audit log is not open to accountants', async () => {
    await get(staff.accountant, '/audit-logs').expect(403);
  });
});

describe('accountants', () => {
  it('can record repayments and read reports, but not approve loans', async () => {
    await get(staff.accountant, '/reports').expect(200);
    const code = await approvedApplication(staff.analyst);
    await post(staff.accountant, `/applications/${code}/disburse`, {
      channel: 'BANK_TRANSFER',
    }).expect(403);
    const loan = await post(staff.manager2, `/applications/${code}/disburse`, {
      channel: 'BANK_TRANSFER',
    }).expect(200);
    await post(staff.accountant, `/loans/${loan.body.loanCode}/payments`, {
      amount: '10000',
      channel: 'BANK_TRANSFER',
      receivedOn: kigaliDate(),
      idempotencyKey: randomUUID(),
    }).expect(200);
  });
});

describe('segregation of duties', () => {
  it('with strict segregation on, the approver cannot also disburse', async () => {
    await setStrict(true);
    const code = await approvedApplication(staff.analyst);
    const refused = await post(staff.manager, `/applications/${code}/disburse`, {
      channel: 'BANK_TRANSFER',
    }).expect(403);
    expect(refused.body.message).toMatch(/another manager must disburse/);
    await post(staff.manager2, `/applications/${code}/disburse`, {
      channel: 'BANK_TRANSFER',
    }).expect(200);
  });

  it('with it off (the default), one manager can approve and disburse', async () => {
    await setStrict(false);
    const code = await approvedApplication(staff.analyst);
    await post(staff.manager, `/applications/${code}/disburse`, {
      channel: 'BANK_TRANSFER',
    }).expect(200);
  });
});
