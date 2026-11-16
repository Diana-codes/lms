import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { kigaliDate, RW_DEFAULT_TERMS } from '@kora/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import type { PrismaClient, StaffRole } from '../src/generated/prisma/client';
import { ACCOUNTS } from '../src/ledger/accounts';
import { signInWithSms, smsTwoFactor } from './sign-in';
import { byCode, E2E_COMPANY_ID, testPrisma } from './test-db';

const PASSWORD = `e2e-${randomUUID()}`;
const PRODUCT = `RPT-${randomUUID().slice(0, 6).toUpperCase()}`;
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const AMOUNT = 1_500_000n;

let app: INestApplication;
let prisma: PrismaClient;
type Agent = { cookies: string[]; id: string };
const staff = {} as Record<'admin' | 'officer' | 'manager', Agent>;

const http = () => request(app.getHttpServer());
const phone = () => `078${randomInt(1_000_000, 9_999_999)}`;
const get = (who: Agent, path: string) => http().get(path).set('Cookie', who.cookies);
const send = (who: Agent, method: 'post', path: string, body: object = {}) =>
  http()[method](path).set('Cookie', who.cookies).set('Origin', ORIGIN).send(body);

async function signIn(role: StaffRole, passwordHash: string): Promise<Agent> {
  const email = `e2e-rpt-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
  const factor = smsTwoFactor();
  const user = await prisma.user.create({
    data: { email, passwordHash, firstName: 'E2E', lastName: role, role, ...factor },
  });
  const res = await signInWithSms(app, { email, phone: factor.phone }, PASSWORD);
  const cookies = ([] as string[]).concat(res.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]!);
  return { cookies, id: user.id };
}

async function disburse(): Promise<void> {
  const created = await send(staff.officer, 'post', '/applications', {
    name: `Report Borrower ${randomUUID().slice(0, 6)}`,
    phone: phone(),
    productCode: PRODUCT,
    amount: AMOUNT.toString(),
    termMonths: 6,
  }).expect(201);
  const code = created.body.code as string;
  await send(staff.officer, 'post', `/applications/${code}/move`, { to: 'UNDER_REVIEW' }).expect(
    200,
  );
  await send(staff.officer, 'post', `/applications/${code}/approve`).expect(200);
  await send(staff.manager, 'post', `/applications/${code}/disburse`, {
    channel: 'BANK_TRANSFER',
  }).expect(200);
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
  const hash = await hashPassword(PASSWORD);
  staff.admin = await signIn('ADMIN', hash);
  staff.officer = await signIn('LOAN_OFFICER', hash);
  staff.manager = await signIn('MANAGER', hash);
  await send(staff.admin, 'post', '/products', {
    code: PRODUCT,
    name: 'Report test loan',
    shortName: 'RPT',
    kind: 'PERSONAL',
    terms: { ...RW_DEFAULT_TERMS, rateBps: 2400, moveOffNonWorkingDays: false },
    minAmount: '100000',
    maxAmount: '5000000',
    minTermMonths: 3,
    maxTermMonths: 24,
  }).expect(201);
  await send(staff.admin, 'post', `/products/${PRODUCT}/publish`).expect(200);
  await disburse();
}, 60_000);

afterAll(async () => {
  await prisma.product.updateMany({ where: { code: PRODUCT }, data: { status: 'RETIRED' } });
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-rpt-' } },
    data: { isActive: false },
  });
  await app.close();
  await prisma.$disconnect();
});

describe('portfolio reports', () => {
  it('managers get period series, product mix and officer rows', async () => {
    const res = await get(staff.manager, '/reports?period=Q').expect(200);
    expect(res.body.period).toBe('Q');
    expect(res.body.asOf).toBe(kigaliDate());
    expect(res.body.series).toHaveLength(3);
    const last = res.body.series[res.body.series.length - 1];
    expect(BigInt(last.outstanding)).toBeGreaterThan(0n);
    expect(last.activeLoans).toBeGreaterThanOrEqual(1);
    expect(res.body.products.some((p: { name: string }) => p.name === 'Report test loan')).toBe(
      true,
    );
    expect(res.body.officers.some((o: { activeLoans: number }) => o.activeLoans >= 1)).toBe(true);
  });

  it('officers cannot open portfolio reports', async () => {
    await get(staff.officer, '/reports?period=12M').expect(403);
    await get(staff.officer, '/reports/export.csv?period=12M').expect(403);
  });

  it('exports CSV with the period in the filename', async () => {
    const res = await get(staff.manager, '/reports/export.csv?period=12M').expect(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('kora-lend-report-12M.csv');
    expect(res.text).toContain('Kora Lend report,12M,as of ');
    expect(res.text).toContain('Month end,Outstanding principal (RWF)');
    expect(res.text).toContain('Report test loan');
  });
});
