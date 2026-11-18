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
const PRODUCT = `CLS-${randomUUID().slice(0, 6).toUpperCase()}`;
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
  const email = `e2e-cls-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
  const factor = smsTwoFactor();
  const user = await prisma.user.create({
    data: { email, passwordHash, firstName: 'E2E', lastName: role, role, ...factor },
  });
  const res = await signInWithSms(app, { email, phone: factor.phone }, PASSWORD);
  const cookies = ([] as string[]).concat(res.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]!);
  return { cookies, id: user.id };
}

async function disburse(amount = 1_000_000n): Promise<string> {
  const created = await send(staff.officer, 'post', '/applications', {
    name: `Class Borrower ${randomUUID().slice(0, 6)}`,
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
  // Signed at a branch: no payout without a signed agreement.
  await send(staff.officer, 'post', `/applications/${code}/agreement`).expect(200);
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
    name: 'Classification test',
    shortName: 'Class',
    kind: 'SME',
    terms: { ...RW_DEFAULT_TERMS, rateBps: 2400, moveOffNonWorkingDays: false },
    minAmount: '100000',
    maxAmount: '5000000',
    minTermMonths: 3,
    maxTermMonths: 12,
  }).expect(201);
  await send(staff.admin, 'post', `/products/${PRODUCT}/publish`).expect(200);
});

afterAll(async () => {
  await prisma.product.updateMany({ where: { code: PRODUCT }, data: { status: 'RETIRED' } });
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-cls-' } },
    data: { isActive: false },
  });
  await app.close();
  await prisma.$disconnect();
});

describe('BNR 59/2023 classification and provisioning', () => {
  it('classifies by DPD, stores the snapshot, and books the allowance', async () => {
    const normalCode = await disburse(1_000_000n);
    const watchCode = await disburse(1_000_000n);
    const subCode = await disburse(1_000_000n);

    const watch = await prisma.loan.findFirstOrThrow({
      where: { code: watchCode },
      include: { instalments: { orderBy: { number: 'asc' }, take: 1 } },
    });
    const sub = await prisma.loan.findFirstOrThrow({
      where: { code: subCode },
      include: { instalments: { orderBy: { number: 'asc' }, take: 1 } },
    });
    await prisma.scheduleInstalment.update({
      where: { id: watch.instalments[0]!.id },
      data: { dueDate: isoToUtcDate(addDays(today, -45)) },
    });
    await prisma.scheduleInstalment.update({
      where: { id: sub.instalments[0]!.id },
      data: { dueDate: isoToUtcDate(addDays(today, -100)) },
    });

    const jobs = app.get(JobsService);
    const result = await runAsCompany(E2E_COMPANY_ID, () => jobs.classifyAndProvision(today));
    expect(result.profile).toBe('COMPANY');
    expect(result.requiredProvision).toBeGreaterThan(0n);
    // Allowance moves to the required level (may already hold some from earlier runs).
    expect(result.allowanceAfter).toBe(result.requiredProvision);
    expect(result.provisionPosted).toBe(result.requiredProvision - result.allowanceBefore);

    const normalLoan = await prisma.loan.findFirstOrThrow({ where: { code: normalCode } });
    const watchLoan = await prisma.loan.findFirstOrThrow({ where: { code: watchCode } });
    const subLoan = await prisma.loan.findFirstOrThrow({ where: { code: subCode } });
    expect(normalLoan.creditClass).toBe('NORMAL');
    expect(watchLoan.creditClass).toBe('WATCH');
    expect(subLoan.creditClass).toBe('SUBSTANDARD');

    const snap = await prisma.loanClassificationDaily.findMany({
      where: { day: isoToUtcDate(today) },
    });
    expect(snap.some((r) => r.creditClass === 'WATCH' && r.loanCount >= 1)).toBe(true);
    expect(snap.some((r) => r.creditClass === 'SUBSTANDARD' && r.loanCount >= 1)).toBe(true);

    // Second run posts nothing more when the required level is unchanged.
    const again = await runAsCompany(E2E_COMPANY_ID, () => jobs.classifyAndProvision(today));
    expect(again.provisionPosted).toBe(0n);

    const report = await get(staff.manager, '/reports/classification').expect(200);
    expect(report.body.profile).toBe('COMPANY');
    expect(BigInt(report.body.requiredProvision)).toBeGreaterThan(0n);
    expect(BigInt(report.body.allowanceHeld)).toBe(BigInt(report.body.requiredProvision));
    expect(
      report.body.buckets.find((b: { creditClass: string }) => b.creditClass === 'WATCH'),
    ).toBeTruthy();

    const csv = await get(staff.manager, '/reports/classification.csv').expect(200);
    expect(csv.text).toContain('BNR 59/2023');
    expect(csv.text).toContain('Watch');
  });

  it('lets admins switch to the cooperative DPD schedule', async () => {
    const before = await get(staff.admin, '/company/settings').expect(200);
    expect(before.body.creditClassProfile).toBe('COMPANY');
    await send(staff.admin, 'patch', '/company/settings', {
      creditClassProfile: 'COOPERATIVE',
    }).expect(200);
    const after = await get(staff.admin, '/company/settings').expect(200);
    expect(after.body.creditClassProfile).toBe('COOPERATIVE');
    // Put it back so other tests keep the company schedule.
    await send(staff.admin, 'patch', '/company/settings', {
      creditClassProfile: 'COMPANY',
    }).expect(200);
  });
});
