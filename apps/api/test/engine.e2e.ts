import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  addDays,
  isoToUtcDate,
  kigaliDate,
  type LoanTerms,
  quoteLoan,
  RW_DEFAULT_TERMS,
} from '@kora/core';
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

/**
 * The loan engine through the API: a product with Rwanda's default terms
 * (fees with VAT, a third-party charge, a spread fee, daily late charges),
 * and what each step does to the loan, its instalments and the ledger.
 */
const PASSWORD = `e2e-${randomUUID()}`;
const PRODUCT = `ENG-${randomUUID().slice(0, 6).toUpperCase()}`;
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const today = kigaliDate();

const TERMS: LoanTerms = {
  ...RW_DEFAULT_TERMS,
  rateBps: 2400,
  // Fixed dates make the expected schedule easy to rebuild here.
  moveOffNonWorkingDays: false,
  fees: [
    { ...RW_DEFAULT_TERMS.fees[0]! }, // 2% processing, deducted, +18% VAT
    {
      code: 'insurance',
      name: 'Credit life insurance',
      basis: 'PERCENT',
      value: 100,
      timing: 'DEDUCTED',
      thirdParty: true,
      vat: false,
    },
    {
      code: 'monitoring',
      name: 'Monitoring fee',
      basis: 'FIXED',
      value: 6_000,
      timing: 'SPREAD',
      thirdParty: false,
      vat: true,
    },
  ],
};

let app: INestApplication;
let prisma: PrismaClient;
type Agent = { cookies: string[]; id: string };
const staff = {} as Record<'admin' | 'officer' | 'manager', Agent>;

const http = () => request(app.getHttpServer());
const phone = () => `078${randomInt(1_000_000, 9_999_999)}`;
const get = (who: Agent, path: string) => http().get(path).set('Cookie', who.cookies);
const send = (who: Agent, method: 'post' | 'put', path: string, body: object = {}) =>
  http()[method](path).set('Cookie', who.cookies).set('Origin', ORIGIN).send(body);

async function signIn(role: StaffRole, passwordHash: string): Promise<Agent> {
  const email = `e2e-eng-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
  const factor = smsTwoFactor();
  const user = await prisma.user.create({
    data: { email, passwordHash, firstName: 'E2E', lastName: role, role, ...factor },
  });
  const res = await signInWithSms(app, { email, phone: factor.phone }, PASSWORD);
  const cookies = ([] as string[]).concat(res.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]!);
  return { cookies, id: user.id };
}

/** Application → approval → disbursement by bank transfer. Returns the loan code. */
async function disburse(
  amount = 1_200_000n,
  termMonths = 12,
): Promise<{ loan: string; app: string }> {
  const created = await send(staff.officer, 'post', '/applications', {
    name: `Engine Borrower ${randomUUID().slice(0, 6)}`,
    phone: phone(),
    productCode: PRODUCT,
    amount: amount.toString(),
    termMonths,
  }).expect(201);
  const code = created.body.code as string;
  await send(staff.officer, 'post', `/applications/${code}/move`, { to: 'UNDER_REVIEW' }).expect(
    200,
  );
  await send(staff.officer, 'post', `/applications/${code}/approve`).expect(200);
  const res = await send(staff.manager, 'post', `/applications/${code}/disburse`, {
    channel: 'BANK_TRANSFER',
  }).expect(200);
  return { loan: res.body.loanCode as string, app: code };
}

const pay = (loan: string, amount: bigint, receivedOn = today) =>
  send(staff.officer, 'post', `/loans/${loan}/payments`, {
    channel: 'BANK_TRANSFER',
    amount: amount.toString(),
    receivedOn,
    idempotencyKey: randomUUID(),
  });

async function ledgerOf(idempotencyKey: string) {
  const tx = await prisma.ledgerTransaction.findFirstOrThrow({
    where: { idempotencyKey },
    include: { entries: { include: { account: { select: { code: true } } } } },
  });
  const by = (code: string, direction: 'DEBIT' | 'CREDIT') =>
    tx.entries
      .filter((e) => e.account.code === code && e.direction === direction)
      .reduce((s, e) => s + e.amount, 0n);
  return { tx, by };
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

  // The product goes through the products API, as a lender would set it up.
  await send(staff.admin, 'post', '/products', {
    code: PRODUCT,
    name: 'Engine test loan',
    shortName: 'Engine',
    kind: 'SME',
    terms: TERMS,
    minAmount: '100000',
    maxAmount: '20000000',
    minTermMonths: 3,
    maxTermMonths: 24,
  }).expect(201);
  await send(staff.admin, 'post', `/products/${PRODUCT}/publish`).expect(200);
});

afterAll(async () => {
  await prisma.product.updateMany({ where: { code: PRODUCT }, data: { status: 'RETIRED' } });
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-eng-' } },
    data: { isActive: false },
  });
  await app.close();
  await prisma.$disconnect();
});

describe('products', () => {
  it('admins manage products; managers can look; terms are checked', async () => {
    const draft = `ENGD-${randomUUID().slice(0, 5).toUpperCase()}`;
    const base = {
      code: draft,
      name: 'Draft product',
      shortName: 'Draft',
      kind: 'PERSONAL',
      minAmount: '50000',
      maxAmount: '1000000',
      minTermMonths: 1,
      maxTermMonths: 12,
    };
    await send(staff.manager, 'post', '/products', base).expect(403);
    const bad = await send(staff.admin, 'post', '/products', {
      ...base,
      terms: { ...TERMS, frequency: 'WEEKLY', dueDayOfMonth: 5 },
    }).expect(400);
    expect(JSON.stringify(bad.body)).toContain('A fixed due day only works for monthly loans');

    // No terms given: the Rwanda defaults.
    const created = await send(staff.admin, 'post', '/products', base).expect(201);
    expect(created.body).toMatchObject({ status: 'DRAFT', version: 1 });
    expect(created.body.terms.interestMethod).toBe('DECLINING_EQUAL_INSTALMENT');

    // Not open for applications until published.
    await send(staff.officer, 'post', '/applications', {
      name: 'Too Early',
      phone: phone(),
      productCode: draft,
      amount: '100000',
      termMonths: 3,
    }).expect(400);

    const updated = await send(staff.admin, 'put', `/products/${draft}`, {
      terms: { ...RW_DEFAULT_TERMS, interestMethod: 'FLAT', rateBps: 300, ratePeriod: 'MONTH' },
    }).expect(200);
    expect(updated.body.version).toBe(2);
    expect(updated.body.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);

    await get(staff.manager, `/products/${draft}`).expect(200);
    await send(staff.admin, 'post', `/products/${draft}/retire`).expect(200);
    await send(staff.admin, 'post', `/products/${draft}/publish`).expect(409);
    await send(staff.admin, 'put', `/products/${draft}`, { name: 'Changed' }).expect(409);
  });

  it('quotes a sample loan, with the APR, before anything is saved', async () => {
    const res = await send(staff.officer, 'post', '/products/quote', {
      terms: TERMS,
      amount: '1000000',
      termMonths: 12,
    }).expect(200);
    expect(res.body.rows).toHaveLength(12);
    expect(res.body.netDisbursed).toBe('966400'); // less 20,000 + 3,600 VAT + 10,000 insurance
    expect(res.body.aprBps).toBeGreaterThan(2400);
  });
});

describe('disbursing under the engine', () => {
  it('pays out the net amount and posts fees, VAT and the third-party charge', async () => {
    const { loan: code, app: appCode } = await disburse(1_200_000n);
    const expected = quoteLoan({ amount: 1_200_000n, count: 12, terms: TERMS, disbursedOn: today });
    const loan = await prisma.loan.findFirstOrThrow({
      where: { code },
      include: {
        instalments: { orderBy: { number: 'asc' } },
        disbursements: true,
      },
    });
    expect(loan.netDisbursed).toBe(1_200_000n - 24_000n - 4_320n - 12_000n);
    expect(loan.disbursements[0]!.amount).toBe(loan.netDisbursed);
    expect(loan.aprBps).toBe(expected.aprBps);
    expect(loan.productVersion).toBe(1);
    expect((loan.terms as unknown as LoanTerms).fees).toHaveLength(3);
    expect(loan.spreadFeeTotal).toBe(7_080n);
    expect(loan.spreadFeeVat).toBe(1_080n);
    expect(loan.instalments.map((i) => i.feeDue)).toEqual(expected.rows.map((r) => r.fee));
    expect(loan.instalments.map((i) => i.interestDue)).toEqual(
      expected.rows.map((r) => r.interest),
    );

    const { by } = await ledgerOf(`disbursement:${appCode}`);
    expect(by(ACCOUNTS.LOANS_PRINCIPAL.code, 'DEBIT')).toBe(1_200_000n);
    expect(by(ACCOUNTS.BANK.code, 'CREDIT')).toBe(loan.netDisbursed);
    expect(by(ACCOUNTS.FEE_INCOME.code, 'CREDIT')).toBe(24_000n);
    expect(by(ACCOUNTS.VAT_PAYABLE.code, 'CREDIT')).toBe(4_320n);
    expect(by(ACCOUNTS.THIRD_PARTY_PAYABLE.code, 'CREDIT')).toBe(12_000n);
  });

  it('a loan keeps its terms when the product changes later', async () => {
    const { loan: code } = await disburse(500_000n, 6);
    await send(staff.admin, 'put', `/products/${PRODUCT}`, {
      terms: { ...TERMS, rateBps: 3000 },
    }).expect(200);
    const loan = await prisma.loan.findFirstOrThrow({ where: { code } });
    expect((loan.terms as unknown as LoanTerms).rateBps).toBe(2400);
    expect(loan.productVersion).toBe(1);
    // Put the product back for the other tests.
    await send(staff.admin, 'put', `/products/${PRODUCT}`, { terms: TERMS }).expect(200);
  });
});

describe('Key Facts Statement', () => {
  it('discloses the BNR items for an application and for the loan it became', async () => {
    const { loan, app: appCode } = await disburse(1_000_000n);
    const app = await get(staff.officer, `/applications/${appCode}/key-facts`).expect(200);
    const kfs = app.body;
    expect(kfs.summary).toMatchObject({
      amount: '1000000',
      durationMonths: 12,
      amountReceived: '966400',
    });
    const interest = BigInt(kfs.cost.totalInterest);
    // 2% processing + 18% VAT, and 1% insurance (third party); 6,000 + VAT monitoring, spread.
    expect(kfs.cost.otherFees).toBe('40680');
    expect(BigInt(kfs.cost.totalCost)).toBe(interest + 40_680n);
    expect(BigInt(kfs.repayment.totalToPay)).toBe(1_000_000n + interest + 40_680n);
    expect(kfs.repayment).toMatchObject({ instalments: 12, frequency: 'Monthly' });
    expect(kfs.fees.upfront.map((f: { name: string }) => f.name)).toEqual([
      'Processing fee',
      'Credit life insurance',
    ]);
    expect(kfs.fees.recurring[0]).toMatchObject({ name: 'Monitoring fee', perInstalment: '590' });
    expect(kfs.escalation.sms).toBe('6005');

    const loanKfs = await get(staff.officer, `/loans/${loan}/key-facts`).expect(200);
    expect(loanKfs.body.cost.aprBps).toBe(kfs.cost.aprBps);
    expect(loanKfs.body.summary.amountReceived).toBe('966400');
  });
});

describe('servicing under the engine', () => {
  it('charges late fees nightly, once a day, on what is overdue only', async () => {
    const { loan: code } = await disburse(1_200_000n);
    const loan = await prisma.loan.findFirstOrThrow({
      where: { code },
      include: { instalments: { orderBy: { number: 'asc' } } },
    });
    const first = loan.instalments[0]!;
    // Make instalment 1 thirteen days overdue: 3 days' grace, then 10 days of charges.
    await prisma.scheduleInstalment.update({
      where: { id: first.id },
      data: { dueDate: isoToUtcDate(addDays(today, -13)) },
    });
    const jobs = app.get(JobsService);
    await runAsCompany(E2E_COMPANY_ID, () => jobs.chargeLateFees(today));
    await runAsCompany(E2E_COMPANY_ID, () => jobs.chargeLateFees(today));
    const after = await prisma.scheduleInstalment.findUniqueOrThrow({ where: { id: first.id } });
    const overdue = first.principalDue + first.interestDue;
    // 24% a year for 10 days, rounded to the franc.
    const expected = (overdue * 2400n * 10n * 2n + 10_000n * 365n) / (10_000n * 365n * 2n);
    expect(after.penaltyDue).toBe(expected);
    expect(after.penaltyThrough?.toISOString().slice(0, 10)).toBe(today);

    // A payment of the whole instalment goes to the penalty, the fee, then interest and principal.
    const owed = after.penaltyDue + after.feeDue + after.interestDue + after.principalDue;
    const res = await pay(code, owed).expect(200);
    const paid = await prisma.scheduleInstalment.findUniqueOrThrow({ where: { id: first.id } });
    expect(paid.status).toBe('PAID');
    expect(paid.penaltyPaid).toBe(after.penaltyDue);
    const payment = await prisma.payment.findFirstOrThrow({ where: { id: res.body.paymentId } });
    const { by } = await ledgerOf(payment.idempotencyKey);
    expect(by(ACCOUNTS.PENALTY_INCOME.code, 'CREDIT')).toBe(after.penaltyDue);
    expect(by(ACCOUNTS.INTEREST_INCOME.code, 'CREDIT')).toBe(first.interestDue);
    // 590 of spread fee: 90 of it is VAT (1,080 / 7,080), 500 is income.
    expect(by(ACCOUNTS.VAT_PAYABLE.code, 'CREDIT')).toBe(90n);
    expect(by(ACCOUNTS.FEE_INCOME.code, 'CREDIT')).toBe(500n);
  });

  it('paying early clears the next instalment, not principal', async () => {
    const { loan: code } = await disburse(1_200_000n);
    const before = await prisma.loan.findFirstOrThrow({
      where: { code },
      include: { instalments: { orderBy: { number: 'asc' } } },
    });
    const first = before.instalments[0]!;
    await pay(code, first.principalDue + first.interestDue + first.feeDue).expect(200);
    const after = await prisma.loan.findFirstOrThrow({
      where: { code },
      include: { instalments: { where: { supersededAt: null }, orderBy: { number: 'asc' } } },
    });
    expect(after.scheduleVersion).toBe(before.scheduleVersion);
    expect(after.instalments[0]!.status).toBe('PAID');
    expect(after.instalments).toHaveLength(12);
  });

  it('money beyond the next instalment repays principal early and shortens the loan', async () => {
    const { loan: code } = await disburse(1_200_000n);
    const before = await prisma.loan.findFirstOrThrow({
      where: { code },
      include: { instalments: { where: { supersededAt: null }, orderBy: { number: 'asc' } } },
    });
    const first = before.instalments[0]!;
    const next = first.principalDue + first.interestDue + first.feeDue;
    await pay(code, next + 300_000n).expect(200);
    const after = await prisma.loan.findFirstOrThrow({
      where: { code },
      include: { instalments: { where: { supersededAt: null }, orderBy: { number: 'asc' } } },
    });
    expect(after.scheduleVersion).toBe(before.scheduleVersion + 1);
    expect(after.instalments[0]!.status).toBe('PAID');
    expect(after.instalments.length).toBeLessThan(before.instalments.length);
    const principalLeft = after.instalments
      .filter((i) => i.status !== 'PAID')
      .reduce((s, i) => s + i.principalDue, 0n);
    expect(principalLeft).toBe(1_200_000n - first.principalDue - 300_000n);
    // The instalment stays the same (principal + interest); the loan just ends sooner.
    const was = before.instalments[1]!;
    const now = after.instalments[1]!;
    expect(now.principalDue + now.interestDue).toBe(was.principalDue + was.interestDue);
  });

  it('pays off early with interest to date only, and closes the loan', async () => {
    const { loan: code } = await disburse(800_000n, 6);
    const detail = await get(staff.officer, `/loans/${code}`).expect(200);
    const payoff = detail.body.figures.payoff;
    // Disbursed today and paid off today: the principal and nothing else.
    expect(payoff.total).toBe('800000');
    expect(BigInt(payoff.waived)).toBeGreaterThan(0n);
    await pay(code, 800_001n).expect(400);
    const res = await pay(code, 800_000n).expect(200);
    expect(res.body.loan.status).toBe('REPAID');
    const loan = await prisma.loan.findFirstOrThrow({
      where: { code },
      include: { instalments: { where: { supersededAt: null } } },
    });
    expect(loan.instalments.every((i) => i.status === 'PAID')).toBe(true);
    expect(loan.instalments.reduce((s, i) => s + i.interestDue, 0n)).toBe(0n);
  });
});

describe('interest accrual', () => {
  it('posts receivable on the due date; repayment clears it, not income again', async () => {
    const { loan: code } = await disburse(1_200_000n);
    const loan = await prisma.loan.findFirstOrThrow({
      where: { code },
      include: { instalments: { orderBy: { number: 'asc' } } },
    });
    const first = loan.instalments[0]!;
    await prisma.scheduleInstalment.update({
      where: { id: first.id },
      data: { dueDate: isoToUtcDate(today) },
    });

    const jobs = app.get(JobsService);
    const once = await runAsCompany(E2E_COMPANY_ID, () => jobs.accrueInterest(today));
    const twice = await runAsCompany(E2E_COMPANY_ID, () => jobs.accrueInterest(today));
    expect(once.instalments).toBeGreaterThanOrEqual(1);
    expect(twice.instalments).toBe(0);

    const accrued = await prisma.scheduleInstalment.findUniqueOrThrow({ where: { id: first.id } });
    expect(accrued.interestAccrued).toBe(first.interestDue);
    const { by: byAccrual } = await ledgerOf(`interest-accrual:${first.id}:0`);
    expect(byAccrual(ACCOUNTS.INTEREST_RECEIVABLE.code, 'DEBIT')).toBe(first.interestDue);
    expect(byAccrual(ACCOUNTS.INTEREST_INCOME.code, 'CREDIT')).toBe(first.interestDue);

    const owed = first.penaltyDue + first.feeDue + first.interestDue + first.principalDue;
    const res = await pay(code, owed).expect(200);
    const payment = await prisma.payment.findFirstOrThrow({ where: { id: res.body.paymentId } });
    const { by } = await ledgerOf(payment.idempotencyKey);
    expect(by(ACCOUNTS.INTEREST_RECEIVABLE.code, 'CREDIT')).toBe(first.interestDue);
    expect(by(ACCOUNTS.INTEREST_INCOME.code, 'CREDIT')).toBe(0n);
  });

  it('does not accrue interest once the loan is 91+ days late, and resumes on cure', async () => {
    const { loan: code } = await disburse(900_000n, 6);
    const loan = await prisma.loan.findFirstOrThrow({
      where: { code },
      include: { instalments: { orderBy: { number: 'asc' } } },
    });
    const first = loan.instalments[0]!;
    const second = loan.instalments[1]!;
    // Oldest unpaid instalment 91 days late → accrual suspended.
    await prisma.scheduleInstalment.update({
      where: { id: first.id },
      data: { dueDate: isoToUtcDate(addDays(today, -91)) },
    });
    await prisma.scheduleInstalment.update({
      where: { id: second.id },
      data: { dueDate: isoToUtcDate(today) },
    });

    const jobs = app.get(JobsService);
    const stopped = await runAsCompany(E2E_COMPANY_ID, () => jobs.accrueInterest(today));
    expect(stopped.suspended).toBeGreaterThanOrEqual(1);
    const afterStop = await prisma.loan.findFirstOrThrow({ where: { code } });
    expect(afterStop.interestSuspendedAt).not.toBeNull();
    const rows = await prisma.scheduleInstalment.findMany({
      where: { id: { in: [first.id, second.id] } },
    });
    expect(rows.every((r) => r.interestAccrued === 0n)).toBe(true);

    // Cure: pay the overdue instalment so DPD returns to current, then accrue.
    const overdue =
      first.penaltyDue + first.feeDue + first.interestDue + first.principalDue;
    await pay(code, overdue).expect(200);
    const resumed = await runAsCompany(E2E_COMPANY_ID, () => jobs.accrueInterest(today));
    expect(resumed.resumed).toBeGreaterThanOrEqual(1);
    const cured = await prisma.loan.findFirstOrThrow({ where: { code } });
    expect(cured.interestSuspendedAt).toBeNull();
    const secondAfter = await prisma.scheduleInstalment.findUniqueOrThrow({
      where: { id: second.id },
    });
    expect(secondAfter.interestAccrued).toBe(second.interestDue);
  });
});
