import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { addMonths, kigaliDate, legacyTerms, monthStart } from '@kora/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import type { PrismaClient, StaffRole } from '../src/generated/prisma/client';
import { ACCOUNTS } from '../src/ledger/accounts';
import { signInWithSms, smsTwoFactor } from './sign-in';
import { byCode, E2E_COMPANY_ID, testPrisma } from './test-db';

/** PRD §10 and §6.13: journals, statements, periods, write-offs and recoveries. */
const PASSWORD = `e2e-${randomUUID()}`;
const PRODUCT = `E2A-${randomUUID().slice(0, 8)}`;
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const today = kigaliDate();
const lastMonth = monthStart(addMonths(monthStart(today), -1));
// A month far enough back that no other suite posts into it.
const oldMonth = '2019-03-01';

let app: INestApplication;
let prisma: PrismaClient;
type Agent = { cookies: string[]; id: string };
const staff = {} as Record<
  'accountant' | 'accountant2' | 'auditor' | 'manager' | 'manager2' | 'admin' | 'officer',
  Agent
>;

const http = () => request(app.getHttpServer());
const get = (who: Agent, path: string) => http().get(path).set('Cookie', who.cookies);
const post = (who: Agent, path: string, body: object = {}) =>
  http().post(path).set('Cookie', who.cookies).set('Origin', ORIGIN).send(body);

async function signIn(role: StaffRole, passwordHash: string): Promise<Agent> {
  const email = `e2e-acct-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
  const factor = smsTwoFactor();
  const user = await prisma.user.create({
    data: { email, passwordHash, firstName: 'E2E', lastName: role, role, ...factor },
  });
  const res = await signInWithSms(app, { email, phone: factor.phone }, PASSWORD);
  const cookies = ([] as string[]).concat(res.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]!);
  return { cookies, id: user.id };
}

async function disbursedLoan(): Promise<string> {
  const created = await post(staff.officer, '/applications', {
    name: `E2E Acct ${randomUUID().slice(0, 6)}`,
    phone: `078${randomInt(1_000_000, 9_999_999)}`,
    productCode: PRODUCT,
    amount: '1000000',
    termMonths: 10,
  }).expect(201);
  const code = created.body.code as string;
  await post(staff.officer, `/applications/${code}/move`, { to: 'UNDER_REVIEW' }).expect(200);
  await post(staff.manager, `/applications/${code}/approve`).expect(200);
  const res = await post(staff.manager, `/applications/${code}/disburse`, {
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
  await prisma.accountingPeriod.deleteMany({ where: { companyId: E2E_COMPANY_ID } });
  // The test database is kept between runs: clear drafts an earlier run left in the old month.
  await prisma.journalEntry.updateMany({
    where: {
      companyId: E2E_COMPANY_ID,
      status: 'PENDING',
      effectiveOn: { lt: new Date('2020-01-01') },
    },
    data: { status: 'REJECTED', rejectReason: 'Left by an earlier test run' },
  });
  await prisma.product.create({
    data: {
      code: PRODUCT,
      name: 'E2E accounting product',
      shortName: 'Acct',
      kind: 'SME',
      terms: legacyTerms(2400) as object,
      annualRateBps: 2400,
      minTermMonths: 3,
      maxTermMonths: 24,
      minAmount: 100_000n,
      maxAmount: 10_000_000n,
    },
  });
  const hash = await hashPassword(PASSWORD);
  staff.accountant = await signIn('ACCOUNTANT', hash);
  staff.accountant2 = await signIn('ACCOUNTANT', hash);
  staff.auditor = await signIn('AUDITOR', hash);
  staff.manager = await signIn('MANAGER', hash);
  staff.manager2 = await signIn('MANAGER', hash);
  staff.admin = await signIn('ADMIN', hash);
  staff.officer = await signIn('LOAN_OFFICER', hash);
});

afterAll(async () => {
  await prisma.accountingPeriod.deleteMany({ where: { companyId: E2E_COMPANY_ID } });
  await prisma.product.updateMany({ where: { code: PRODUCT }, data: { status: 'RETIRED' } });
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-acct-' } },
    data: { isActive: false },
  });
  await app.close();
  await prisma.$disconnect();
});

const balanceOf = async (code: string) => {
  const tb = await get(staff.auditor, `/accounting/trial-balance?asOf=${today}`).expect(200);
  const row = tb.body.rows.find((r: { code: string }) => r.code === code);
  return row ? BigInt(row.debit) - BigInt(row.credit) : 0n;
};

describe('manual journals', () => {
  it('an expense posts only after someone else approves it', async () => {
    const rentBefore = await balanceOf('5210');
    const drafted = await post(staff.accountant, '/accounting/expenses', {
      expenseAccount: '5210',
      paidFrom: 'BANK',
      amount: '150,000',
      effectiveOn: today,
      memo: 'Office rent, November',
    }).expect(201);
    expect(drafted.body.code).toMatch(/^JV-\d{5}$/);
    expect(await balanceOf('5210')).toBe(rentBefore);

    const own = await post(staff.accountant, `/accounting/journals/${drafted.body.code}/decide`, {
      approve: true,
    }).expect(403);
    expect(own.body.message).toMatch(/Someone other than/);

    await post(staff.accountant2, `/accounting/journals/${drafted.body.code}/decide`, {
      approve: true,
    }).expect(200);
    expect(await balanceOf('5210')).toBe(rentBefore + 150_000n);
    await post(staff.manager, `/accounting/journals/${drafted.body.code}/decide`, {
      approve: true,
    }).expect(409);
  });

  it('refuses unbalanced journals and loan control accounts', async () => {
    await post(staff.accountant, '/accounting/journals', {
      effectiveOn: today,
      memo: 'Unbalanced',
      lines: [
        { accountCode: '5290', direction: 'DEBIT', amount: '100' },
        { accountCode: '1000', direction: 'CREDIT', amount: '90' },
      ],
    }).expect(400);
    const control = await post(staff.accountant, '/accounting/journals', {
      effectiveOn: today,
      memo: 'Sneaky loan balance change',
      lines: [
        { accountCode: '1100', direction: 'DEBIT', amount: '100' },
        { accountCode: '1000', direction: 'CREDIT', amount: '100' },
      ],
    }).expect(400);
    expect(control.body.message).toMatch(/only through loan events/);
  });

  it('a rejection needs a reason and posts nothing', async () => {
    const drafted = await post(staff.accountant, '/accounting/journals', {
      effectiveOn: today,
      memo: 'Capital injection',
      lines: [
        { accountCode: '1000', direction: 'DEBIT', amount: '5000000' },
        { accountCode: '3000', direction: 'CREDIT', amount: '5000000' },
      ],
    }).expect(201);
    await post(staff.manager, `/accounting/journals/${drafted.body.code}/decide`, {
      approve: false,
    }).expect(400);
    await post(staff.manager, `/accounting/journals/${drafted.body.code}/decide`, {
      approve: false,
      reason: 'No board resolution attached',
    }).expect(200);
    const list = await get(staff.auditor, '/accounting/journals?status=REJECTED').expect(200);
    expect(list.body.map((j: { code: string }) => j.code)).toContain(drafted.body.code);
  });

  it('staff can add their own accounts and use them', async () => {
    const code = `52${randomInt(60, 89)}`;
    await prisma.ledgerAccount.deleteMany({
      where: { companyId: E2E_COMPANY_ID, code, entries: { none: {} } },
    });
    await post(staff.accountant, '/accounting/accounts', {
      code: '1999',
      name: 'Wrong range',
      type: 'EXPENSE',
    }).expect(400);
    await post(staff.accountant, '/accounting/accounts', {
      code,
      name: 'Marketing',
      type: 'EXPENSE',
    }).expect(201);
    const accounts = await get(staff.auditor, '/accounting/accounts').expect(200);
    expect(accounts.body.find((a: { code: string }) => a.code === code)).toMatchObject({
      system: false,
      isActive: true,
    });
  });
});

describe('statements', () => {
  it('the trial balance and balance sheet balance; the income statement adds up', async () => {
    const tb = await get(staff.auditor, '/accounting/trial-balance').expect(200);
    expect(tb.body.balanced).toBe(true);
    const bs = await get(staff.auditor, '/accounting/balance-sheet').expect(200);
    expect(bs.body.balanced).toBe(true);
    const is = await get(
      staff.auditor,
      `/accounting/income-statement?from=${today.slice(0, 4)}-01-01&to=${today}`,
    ).expect(200);
    expect(BigInt(is.body.netProfit)).toBe(
      BigInt(is.body.totalIncome) - BigInt(is.body.totalExpenses),
    );
    const csv = await get(staff.auditor, '/accounting/export.csv?statement=trial-balance').expect(
      200,
    );
    expect(csv.text.split('\r\n')[1]).toBe('Code,Account,Debit,Credit');
  });

  it('auditors read the books but cannot change them', async () => {
    await post(staff.auditor, '/accounting/journals', {
      effectiveOn: today,
      memo: 'Nope',
      lines: [],
    }).expect(403);
    await get(staff.officer, '/accounting/trial-balance').expect(403);
  });
});

describe('accounting periods', () => {
  it('a closed month takes no postings until an administrator reopens it', async () => {
    const draft = await post(staff.accountant, '/accounting/expenses', {
      expenseAccount: '5220',
      paidFrom: 'BANK',
      amount: '20000',
      effectiveOn: '2019-03-15',
      memo: 'Old internet bill',
    }).expect(201);
    const blocked = await post(staff.accountant, '/accounting/periods/close', {
      month: oldMonth,
    }).expect(409);
    expect(blocked.body.message).toMatch(/journal/);
    await post(staff.manager, `/accounting/journals/${draft.body.code}/decide`, {
      approve: true,
    }).expect(200);

    await post(staff.accountant, '/accounting/periods/close', { month: oldMonth }).expect(200);
    const refused = await post(staff.accountant, '/accounting/expenses', {
      expenseAccount: '5220',
      paidFrom: 'BANK',
      amount: '1000',
      effectiveOn: '2019-03-20',
      memo: 'Late bill',
    }).expect(409);
    expect(refused.body.message).toMatch(/closed/);

    await post(staff.manager, '/accounting/periods/reopen', {
      month: oldMonth,
      reason: 'Bill arrived late',
    }).expect(403);
    await post(staff.admin, '/accounting/periods/reopen', {
      month: oldMonth,
      reason: 'Bill arrived late',
    }).expect(200);
    const late = await post(staff.accountant, '/accounting/expenses', {
      expenseAccount: '5220',
      paidFrom: 'BANK',
      amount: '1000',
      effectiveOn: '2019-03-20',
      memo: 'Late bill',
    }).expect(201);
    await post(staff.accountant2, `/accounting/journals/${late.body.code}/decide`, {
      approve: true,
    }).expect(200);
  });

  it('the current month cannot be closed yet', async () => {
    await post(staff.accountant, '/accounting/periods/close', { month: today }).expect(409);
    const periods = await get(staff.auditor, '/accounting/periods').expect(200);
    expect(periods.body[0].month).toBe(monthStart(today));
    expect(periods.body[1].month).toBe(lastMonth);
  });

  it('the database itself refuses postings into a closed month', async () => {
    await prisma.accountingPeriod.create({
      data: { companyId: E2E_COMPANY_ID, month: new Date('2019-05-01'), closedAt: new Date() },
    });
    const cash = await prisma.ledgerAccount.findFirstOrThrow({
      where: { companyId: E2E_COMPANY_ID, code: '1000' },
    });
    const capital = await prisma.ledgerAccount.findFirstOrThrow({
      where: { companyId: E2E_COMPANY_ID, code: '3000' },
    });
    await expect(
      prisma.ledgerTransaction.create({
        data: {
          companyId: E2E_COMPANY_ID,
          type: 'ADJUSTMENT',
          idempotencyKey: `closed:${randomUUID()}`,
          effectiveOn: new Date('2019-05-10'),
          entries: {
            create: [
              { companyId: E2E_COMPANY_ID, accountId: cash.id, direction: 'DEBIT', amount: 1n },
              { companyId: E2E_COMPANY_ID, accountId: capital.id, direction: 'CREDIT', amount: 1n },
            ],
          },
        },
      }),
    ).rejects.toThrow(/closed/);
  });
});

describe('write-offs and recoveries', () => {
  it('needs a non-performing loan and a second person; then clears the loan', async () => {
    const loan = await disbursedLoan();
    const early = await post(staff.manager, `/loans/${loan}/write-off`, {
      reason: 'Borrower has left the country',
    }).expect(409);
    expect(early.body.message).toMatch(/non-performing/);

    await prisma.loan.update({ where: byCode(loan), data: { creditClass: 'DOUBTFUL' } });
    const requested = await post(staff.manager, `/loans/${loan}/write-off`, {
      reason: 'Borrower has left the country',
    }).expect(201);
    await post(staff.manager2, `/loans/${loan}/write-off`, {
      reason: 'A second request at the same time',
    }).expect(409);
    await post(staff.manager, `/write-offs/${requested.body.id}/decide`, { approve: true }).expect(
      403,
    );
    await post(staff.officer, `/write-offs/${requested.body.id}/decide`, { approve: true }).expect(
      403,
    );

    const writeOffsBefore = await balanceOf('5000');
    await post(staff.manager2, `/write-offs/${requested.body.id}/decide`, {
      approve: true,
    }).expect(200);

    const detail = await get(staff.manager, `/loans/${loan}`).expect(200);
    expect(detail.body.status).toBe('WRITTEN_OFF');
    const row = await prisma.loan.findFirstOrThrow({
      where: { companyId: E2E_COMPANY_ID, code: loan },
    });
    const history = await get(staff.manager, `/loans/${loan}/write-offs`).expect(200);
    const wo = history.body.requests[0];
    expect(wo.status).toBe('APPROVED');
    expect(BigInt(wo.principal)).toBe(1_000_000n);
    expect(await balanceOf('5000')).toBe(
      writeOffsBefore + BigInt(wo.principal) + BigInt(wo.interest) - BigInt(wo.allowanceUsed),
    );
    const outstanding = await prisma.$queryRaw<Array<{ b: bigint }>>`
      SELECT COALESCE(SUM(CASE WHEN e."direction"='DEBIT' THEN e."amount" ELSE -e."amount" END),0)::bigint AS b
      FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a."id"=e."accountId"
      WHERE e."loanId"=${row.id}::uuid AND a."code"='1100'`;
    expect(outstanding[0]!.b).toBe(0n);

    // Normal repayments stop; recoveries are recorded separately.
    await post(staff.accountant, `/loans/${loan}/payments`, {
      amount: '50000',
      channel: 'CASH',
      receivedOn: today,
      idempotencyKey: randomUUID(),
    }).expect(409);
    const recoveriesBefore = await balanceOf('4030');
    const key = randomUUID();
    const body = { amount: '50000', channel: 'CASH', receivedOn: today, idempotencyKey: key };
    await post(staff.accountant, `/loans/${loan}/recoveries`, body).expect(200);
    const again = await post(staff.accountant, `/loans/${loan}/recoveries`, body).expect(200);
    expect(again.body.duplicate).toBe(true);
    expect(await balanceOf('4030')).toBe(recoveriesBefore - 50_000n);
    const after = await get(staff.manager, `/loans/${loan}/write-offs`).expect(200);
    expect(after.body.recovered).toBe('50000');
  });

  it('a rejected request leaves the loan active', async () => {
    const loan = await disbursedLoan();
    await prisma.loan.update({ where: byCode(loan), data: { creditClass: 'LOSS' } });
    const requested = await post(staff.manager, `/loans/${loan}/write-off`, {
      reason: 'Business closed down last month',
    }).expect(201);
    await post(staff.manager2, `/write-offs/${requested.body.id}/decide`, {
      approve: false,
    }).expect(200);
    const detail = await get(staff.manager, `/loans/${loan}`).expect(200);
    expect(detail.body.status).toBe('ACTIVE');
  });
});
