import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { addDays, isoToUtcDate, kigaliDate, RW_DEFAULT_TERMS } from '@kora/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import type { PrismaClient, StaffRole } from '../src/generated/prisma/client';
import { JobsService } from '../src/jobs/jobs.service';
import { ACCOUNTS } from '../src/ledger/accounts';
import { runAsCompany } from '../src/tenancy/company-context';
import { signInWithSms, smsTwoFactor } from './sign-in';
import { byCode, E2E_COMPANY_ID, testPrisma } from './test-db';

const PASSWORD = `e2e-${randomUUID()}`;
const PRODUCT = `COL-${randomUUID().slice(0, 6).toUpperCase()}`;
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const today = kigaliDate();

let app: INestApplication;
let prisma: PrismaClient;
type Agent = { cookies: string[]; id: string };
const staff = {} as Record<'admin' | 'officer' | 'manager', Agent>;

const http = () => request(app.getHttpServer());
const phone = () => `078${randomInt(1_000_000, 9_999_999)}`;
const get = (who: Agent, path: string) => http().get(path).set('Cookie', who.cookies);
const send = (who: Agent, method: 'post' | 'put' | 'patch', path: string, body: object = {}) =>
  http()[method](path).set('Cookie', who.cookies).set('Origin', ORIGIN).send(body);

async function signIn(role: StaffRole, passwordHash: string): Promise<Agent> {
  const email = `e2e-col-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
  const factor = smsTwoFactor();
  const user = await prisma.user.create({
    data: { email, passwordHash, firstName: 'E2E', lastName: role, role, ...factor },
  });
  const res = await signInWithSms(app, { email, phone: factor.phone }, PASSWORD);
  const cookies = ([] as string[]).concat(res.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]!);
  return { cookies, id: user.id };
}

async function disburse(amount = 2_000_000n): Promise<string> {
  const created = await send(staff.officer, 'post', '/applications', {
    name: `Collateral Borrower ${randomUUID().slice(0, 6)}`,
    phone: phone(),
    productCode: PRODUCT,
    amount: amount.toString(),
    termMonths: 6,
  }).expect(201);
  const code = created.body.code as string;
  await send(staff.officer, 'post', `/applications/${code}/move`, { to: 'UNDER_REVIEW' }).expect(
    200,
  );
  await send(staff.officer, 'post', `/applications/${code}/approve`).expect(200);
  const res = await send(staff.manager, 'post', `/applications/${code}/disburse`, {
    channel: 'BANK_TRANSFER',
  }).expect(200);
  return res.body.loanCode as string;
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
    name: 'Collateral test',
    shortName: 'Coll',
    kind: 'SME',
    terms: { ...RW_DEFAULT_TERMS, rateBps: 2400, moveOffNonWorkingDays: false },
    minAmount: '100000',
    maxAmount: '10000000',
    minTermMonths: 3,
    maxTermMonths: 12,
  }).expect(201);
  await send(staff.admin, 'post', `/products/${PRODUCT}/publish`).expect(200);
});

afterAll(async () => {
  await prisma.product.updateMany({ where: { code: PRODUCT }, data: { status: 'RETIRED' } });
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-col-' } },
    data: { isActive: false },
  });
  await app.close();
  await prisma.$disconnect();
});

describe('collateral and guarantors', () => {
  it('records collateral and guarantors on a loan', async () => {
    const code = await disburse();
    const col = await send(staff.officer, 'post', `/loans/${code}/collateral`, {
      kind: 'MOVABLE',
      description: 'Delivery truck',
      marketValue: '1000000',
      insured: true,
    }).expect(201);
    expect(col.body.kind).toBe('MOVABLE');
    expect(col.body.marketValue).toBe('1000000');

    const g = await send(staff.officer, 'post', `/loans/${code}/guarantors`, {
      fullName: 'Jean Guarantor',
      phone: '0781112233',
      relationship: 'Sibling',
      guaranteeAmount: '500000',
    }).expect(201);
    expect(g.body.fullName).toBe('Jean Guarantor');

    const detail = await get(staff.officer, `/loans/${code}`).expect(200);
    expect(detail.body.collaterals).toHaveLength(1);
    expect(detail.body.guarantors).toHaveLength(1);
    expect(detail.body.terms.collateral).toContain('Delivery truck');
    // 30% of 1,000,000 insured movable
    expect(detail.body.terms.admissibleCollateral).toBe('300000');

    await send(staff.officer, 'post', `/loans/${code}/collateral/${col.body.id}/release`).expect(
      200,
    );
    const after = await get(staff.officer, `/loans/${code}`).expect(200);
    expect(after.body.collaterals.find((c: { id: string }) => c.id === col.body.id).released).toBe(
      true,
    );
    expect(after.body.terms.admissibleCollateral).toBe('0');
  });

  it('reduces required provision for Watch+ loans with admissible collateral', async () => {
    const code = await disburse(2_000_000n);
    const loan = await prisma.loan.findFirstOrThrow({
      where: { code },
      include: { instalments: { orderBy: { number: 'asc' }, take: 1 } },
    });
    await prisma.scheduleInstalment.update({
      where: { id: loan.instalments[0]!.id },
      data: { dueDate: isoToUtcDate(addDays(today, -45)) },
    });
    await send(staff.officer, 'post', `/loans/${code}/collateral`, {
      kind: 'CASH',
      description: 'Fixed deposit',
      marketValue: '500000',
    }).expect(201);

    const jobs = app.get(JobsService);
    // Snapshot the required provision with and without thinking about portfolio:
    // this loan alone at Watch with 500k cash on 2M principal → base 1.5M × 5% = 75k.
    const { classifyLoan } = await import('@kora/core');
    const classified = classifyLoan(2_000_000n, 45, 'COMPANY', 500_000n);
    expect(classified.creditClass).toBe('WATCH');
    expect(classified.requiredProvision).toBe(75_000n);

    await runAsCompany(E2E_COMPANY_ID, () => jobs.classifyAndProvision(today));
    const updated = await prisma.loan.findFirstOrThrow({ where: { code } });
    expect(updated.creditClass).toBe('WATCH');
  });
});
