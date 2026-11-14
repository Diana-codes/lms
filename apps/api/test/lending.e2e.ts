import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  addMonths,
  buildSchedule,
  calcInstalment,
  kigaliDate,
  monthlyInterest,
  legacyTerms,
} from '@kora/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import type { StaffRole } from '../src/generated/prisma/client';
import { ACCOUNTS } from '../src/ledger/accounts';
import type { PrismaClient } from '../src/generated/prisma/client';
import { signInWithSms, smsTwoFactor } from './sign-in';
import { testPrisma, byCode, E2E_COMPANY_ID } from './test-db';

/**
 * Phase 1 lending flows, end to end against a real Postgres: application to
 * approval to disbursement, repayments, and restructures. The tests build
 * their own product, staff and borrowers.
 */
const PASSWORD = `e2e-${randomUUID()}`;
const PRODUCT = `E2E-${randomUUID().slice(0, 8)}`;
const today = kigaliDate();

let app: INestApplication;
let prisma: PrismaClient;
type Agent = { cookies: string[]; id: string };
const staff = {} as Record<'officer' | 'officer2' | 'manager' | 'manager2' | 'collections', Agent>;

const http = () => request(app.getHttpServer());
const phone = () => `078${randomInt(1_000_000, 9_999_999)}`;
const get = (who: Agent, path: string) => http().get(path).set('Cookie', who.cookies);
const post = (who: Agent, path: string, body: object = {}) =>
  http().post(path).set('Cookie', who.cookies).send(body);

async function signIn(role: StaffRole, passwordHash: string): Promise<Agent> {
  const email = `e2e-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
  const factor = smsTwoFactor();
  const user = await prisma.user.create({
    data: { email, passwordHash, firstName: 'E2E', lastName: role, role, ...factor },
  });
  const res = await signInWithSms(app, { email, phone: factor.phone }, PASSWORD);
  const cookies = ([] as string[]).concat(res.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]!);
  return { cookies, id: user.id };
}

/** Create an application and walk it to the given point. */
async function newApplication(amount: string, opts: { income?: bigint; name?: string } = {}) {
  const res = await post(staff.officer, '/applications', {
    name: opts.name ?? `E2E Borrower ${randomUUID().slice(0, 6)}`,
    phone: phone(),
    productCode: PRODUCT,
    amount,
    termMonths: 12,
  }).expect(201);
  if (opts.income != null) {
    await prisma.borrower.update({
      where: byCode(res.body.borrowerCode),
      data: { monthlyIncome: opts.income },
    });
  }
  return res.body as { code: string; borrowerCode: string; stage: string };
}

async function disbursedLoan(amount = '1200000'): Promise<string> {
  const created = await newApplication(amount);
  await post(staff.officer, `/applications/${created.code}/move`, { to: 'UNDER_REVIEW' }).expect(
    200,
  );
  await post(staff.officer, `/applications/${created.code}/approve`).expect(200);
  const res = await post(staff.manager, `/applications/${created.code}/disburse`, {
    channel: 'BANK_TRANSFER',
  }).expect(200);
  return res.body.loanCode as string;
}

const pay = (who: Agent, loan: string, body: object) =>
  post(who, `/loans/${loan}/payments`, {
    channel: 'MTN_MOMO',
    receivedOn: today,
    idempotencyKey: randomUUID(),
    ...body,
  });

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
      name: 'E2E working capital',
      shortName: 'E2E',
      kind: 'SME',
      terms: legacyTerms(1800) as object,
      annualRateBps: 1800,
      minTermMonths: 3,
      maxTermMonths: 36,
      minAmount: 100_000n,
      maxAmount: 50_000_000n,
      secondApprovalAbove: 5_000_000n,
    },
  });
  const hash = await hashPassword(PASSWORD);
  staff.officer = await signIn('LOAN_OFFICER', hash);
  staff.officer2 = await signIn('LOAN_OFFICER', hash);
  staff.manager = await signIn('MANAGER', hash);
  staff.manager2 = await signIn('MANAGER', hash);
  staff.collections = await signIn('COLLECTIONS_AGENT', hash);
});

afterAll(async () => {
  await prisma.product.updateMany({ where: { code: PRODUCT }, data: { status: 'RETIRED' } });
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-' } },
    data: { isActive: false },
  });
  await app.close();
  await prisma.$disconnect();
});

describe('applications', () => {
  it('creates an application in New, with a new borrower and a reference number', async () => {
    const number = phone();
    const res = await post(staff.officer, '/applications', {
      name: 'Claudine Test',
      phone: number,
      productCode: PRODUCT,
      amount: '1,000,000',
    }).expect(201);
    expect(res.body).toMatchObject({
      stage: 'NEW',
      amount: '1000000',
      termMonths: 12,
      annualRateBps: 1800,
    });
    expect(res.body.code).toMatch(/^APP-\d+$/);
    expect(res.body.borrowerCode).toMatch(/^BR-\d{5}$/);
    expect(res.body.officerId).toBe(staff.officer.id);
    // Scored straight away by the rules service: a first loan is reviewed, never declined.
    expect(res.body.ai).toMatchObject({ recommendation: 'REVIEW', modelVersion: 'rules-v1' });

    // The same phone number means the same borrower.
    const again = await post(staff.officer, '/applications', {
      name: 'Claudine Test',
      phone: `+250${number.slice(1)}`,
      productCode: PRODUCT,
      amount: '500000',
    }).expect(201);
    expect(again.body.borrowerCode).toBe(res.body.borrowerCode);
    expect(again.body.code).not.toBe(res.body.code);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'application.create', entityId: res.body.code },
    });
    expect(audit?.actorId).toBe(staff.officer.id);
    expect(JSON.stringify(audit?.metadata)).not.toContain(number.slice(1));
  });

  it('refuses bad input', async () => {
    const base = { name: 'Test Person', phone: phone(), productCode: PRODUCT, amount: '1000000' };
    await post(staff.officer, '/applications', { ...base, phone: '12345' }).expect(400);
    await post(staff.officer, '/applications', { ...base, amount: '1000000.50' }).expect(400);
    await post(staff.officer, '/applications', { ...base, amount: 1000000 }).expect(400);
    await post(staff.officer, '/applications', { ...base, amount: '50' }).expect(400);
    await post(staff.officer, '/applications', { ...base, amount: '99000000' }).expect(400);
    await post(staff.officer, '/applications', { ...base, productCode: 'NOPE' }).expect(400);
    await post(staff.officer, '/applications', { ...base, termMonths: 120 }).expect(400);
    await post(staff.collections, '/applications', base).expect(403);
  });

  it('only allows the documented stage moves', async () => {
    const a = await newApplication('800000');
    await post(staff.officer, `/applications/${a.code}/move`, { to: 'CREDIT_CHECK' }).expect(409);
    await post(staff.officer, `/applications/${a.code}/approve`).expect(409);
    await post(staff.manager, `/applications/${a.code}/disburse`, { channel: 'MTN_MOMO' }).expect(
      409,
    );
    await post(staff.officer, `/applications/${a.code}/move`, { to: 'UNDER_REVIEW' }).expect(200);
    await post(staff.officer, `/applications/${a.code}/move`, { to: 'CREDIT_CHECK' }).expect(200);
    await post(staff.officer, `/applications/${a.code}/move`, { to: 'DECLINED' }).expect(400);
    const declined = await post(staff.officer, `/applications/${a.code}/move`, {
      to: 'DECLINED',
      reason: 'Could not verify income',
    }).expect(200);
    expect(declined.body).toMatchObject({
      stage: 'DECLINED',
      declineReason: 'Could not verify income',
    });
    // A declined application is closed.
    await post(staff.officer, `/applications/${a.code}/move`, { to: 'UNDER_REVIEW' }).expect(409);
    await get(staff.officer, '/applications/APP-999999999').expect(404);
    await get(staff.officer, '/applications/not-a-code').expect(400);
  });

  it('needs two different people above the product threshold', async () => {
    const a = await newApplication('8000000');
    await post(staff.officer, `/applications/${a.code}/move`, { to: 'UNDER_REVIEW' }).expect(200);

    const first = await post(staff.officer, `/applications/${a.code}/approve`).expect(200);
    expect(first.body.stage).toBe('UNDER_REVIEW');
    expect(first.body.statusNote).toBe('Awaiting second approval');
    expect(first.body.firstApprovalBy.id).toBe(staff.officer.id);

    await post(staff.officer, `/applications/${a.code}/approve`).expect(409);
    await post(staff.officer2, `/applications/${a.code}/approve`).expect(403);
    const second = await post(staff.manager, `/applications/${a.code}/approve`).expect(200);
    expect(second.body.stage).toBe('APPROVED');

    const row = await prisma.application.findFirstOrThrow({ where: { code: a.code } });
    expect(row.decidedById).toBe(staff.officer.id);
    expect(row.secondApproverId).toBe(staff.manager.id);
  });

  it('applies the affordability rule when income is verified', async () => {
    // RWF 2,000,000 over 12 months at 18% is about RWF 183,000 a month.
    const tight = await newApplication('2000000', { income: 400_000n });
    await post(staff.officer, `/applications/${tight.code}/move`, { to: 'UNDER_REVIEW' }).expect(
      200,
    );
    const refused = await post(staff.officer, `/applications/${tight.code}/approve`).expect(422);
    expect(refused.body.message).toMatch(/46% of verified income.*35%/);

    const fine = await newApplication('2000000', { income: 600_000n });
    await post(staff.officer, `/applications/${fine.code}/move`, { to: 'UNDER_REVIEW' }).expect(
      200,
    );
    await post(staff.officer, `/applications/${fine.code}/approve`).expect(200);
  });

  it('shows applications on the pipeline board', async () => {
    const a = await newApplication('900000');
    const res = await get(staff.officer, '/applications').expect(200);
    expect(res.body.columns.map((c: { stage: string }) => c.stage)).toEqual([
      'NEW',
      'UNDER_REVIEW',
      'CREDIT_CHECK',
      'APPROVED',
      'DISBURSED',
    ]);
    const cards = res.body.columns[0].cards as Array<{ code: string }>;
    expect(cards.some((c) => c.code === a.code)).toBe(true);
    const count = await get(staff.officer, '/applications/open-count').expect(200);
    expect(count.body.open).toBeGreaterThan(0);
  });
});

describe('disbursement', () => {
  it('creates the loan, its schedule and the ledger posting together, once', async () => {
    const a = await newApplication('4500000');
    await post(staff.officer, `/applications/${a.code}/move`, { to: 'UNDER_REVIEW' }).expect(200);
    await post(staff.officer, `/applications/${a.code}/approve`).expect(200);

    // Officers approve; managers release the money.
    await post(staff.officer, `/applications/${a.code}/disburse`, {
      channel: 'BANK_TRANSFER',
    }).expect(403);
    const res = await post(staff.manager, `/applications/${a.code}/disburse`, {
      channel: 'BANK_TRANSFER',
      collateral: 'Equipment lien',
    }).expect(200);
    const loanCode: string = res.body.loanCode;
    expect(loanCode).toMatch(new RegExp(`^LN-\\d{4}-${today.slice(0, 4)}$`));
    expect(res.body.application.stage).toBe('DISBURSED');

    const loan = (await get(staff.officer, `/loans/${loanCode}`).expect(200)).body;
    const expected = buildSchedule({
      principal: 4_500_000n,
      annualRateBps: 1800,
      termMonths: 12,
      firstDueDate: addMonths(today, 1),
    });
    expect(loan.terms).toMatchObject({
      principal: '4500000',
      instalment: expected.instalment.toString(),
      disbursedOn: today,
      channel: 'Bank transfer',
      collateral: 'Equipment lien',
    });
    expect(loan.schedule).toHaveLength(12);
    expect(loan.schedule[0]).toMatchObject({
      dueDate: addMonths(today, 1),
      principal: expected.rows[0]!.principal.toString(),
      interest: expected.rows[0]!.interest.toString(),
      state: 'DUE_NEXT',
    });
    expect(loan.schedule[11].balanceAfter).toBe('0');
    expect(loan.figures).toMatchObject({
      outstandingPrincipal: '4500000',
      totalRepaid: '0',
      paidCount: 0,
    });
    expect(loan.statusLabel).toBe('Active · on track');
    expect(JSON.stringify(loan)).not.toMatch(/\+2507\d{8}/);

    // A second attempt cannot create a second loan.
    await post(staff.manager, `/applications/${a.code}/disburse`, { channel: 'MTN_MOMO' }).expect(
      409,
    );
    const row = await prisma.application.findFirstOrThrow({ where: { code: a.code } });
    expect(await prisma.loan.count({ where: { applicationId: row.id } })).toBe(1);
  });
});

describe('recording payments', () => {
  it('clears an instalment and moves the balance through the ledger', async () => {
    const code = await disbursedLoan('1200000');
    const instalment = calcInstalment(1_200_000n, 1800, 12);
    const interest = monthlyInterest(1_200_000n, 1800);

    const res = await pay(staff.collections, code, {
      amount: instalment.toString(),
      externalRef: `MP-${randomUUID().slice(0, 10)}`,
    }).expect(200);
    expect(res.body.replayed).toBe(false);
    const loan = res.body.loan;
    expect(loan.schedule[0].state).toBe('PAID');
    expect(loan.schedule[1].state).toBe('DUE_NEXT');
    expect(loan.figures).toMatchObject({
      paidCount: 1,
      totalRepaid: instalment.toString(),
      outstandingPrincipal: (1_200_000n - (instalment - interest)).toString(),
    });
    expect(loan.activity[0].title).toMatch(/^Instalment 1 recorded by E2E C\. \(MoMo\)$/);

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { id: res.body.paymentId },
      include: { ledgerTransaction: { include: { entries: { include: { account: true } } } } },
    });
    const lines = payment
      .ledgerTransaction!.entries.map((e) => `${e.direction} ${e.account.code} ${e.amount}`)
      .sort();
    expect(lines).toEqual(
      [
        `DEBIT 1010 ${instalment}`,
        `CREDIT 1100 ${instalment - interest}`,
        `CREDIT 4000 ${interest}`,
      ].sort(),
    );
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'loan.payment.record', entityId: code },
    });
    expect(audit?.actorId).toBe(staff.collections.id);
  });

  it('counts a retried request once', async () => {
    const code = await disbursedLoan('1200000');
    const body = {
      amount: '100000',
      channel: 'MTN_MOMO',
      receivedOn: today,
      idempotencyKey: randomUUID(),
    };
    const first = await post(staff.officer, `/loans/${code}/payments`, body).expect(200);
    const retry = await post(staff.officer, `/loans/${code}/payments`, body).expect(200);
    expect(retry.body.replayed).toBe(true);
    expect(retry.body.paymentId).toBe(first.body.paymentId);
    expect(retry.body.loan.figures.totalRepaid).toBe('100000');

    // The same key with a different amount is a mistake, not a retry.
    await post(staff.officer, `/loans/${code}/payments`, { ...body, amount: '200000' }).expect(409);
  });

  it('counts a callback delivered five times at once exactly once', async () => {
    const code = await disbursedLoan('1200000');
    const body = {
      amount: '110000',
      channel: 'MTN_MOMO',
      receivedOn: today,
      idempotencyKey: randomUUID(),
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => post(staff.officer, `/loans/${code}/payments`, body)),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(results.filter((r) => r.body.replayed === false)).toHaveLength(1);

    const loan = await prisma.loan.findFirstOrThrow({ where: { code } });
    expect(await prisma.payment.count({ where: { loanId: loan.id } })).toBe(1);
    const detail = (await get(staff.officer, `/loans/${code}`).expect(200)).body;
    expect(detail.figures.totalRepaid).toBe('110000');
  });

  it('handles two different payments on one loan arriving together', async () => {
    const code = await disbursedLoan('1200000');
    const [a, b] = await Promise.all([
      pay(staff.officer, code, { amount: '50000' }),
      pay(staff.officer2, code, { amount: '40000' }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const detail = (await get(staff.officer, `/loans/${code}`).expect(200)).body;
    expect(detail.figures.totalRepaid).toBe('90000');
    // 90,000 against instalment 1: its interest (18,000) first, the rest to principal.
    expect(detail.figures.outstandingPrincipal).toBe((1_200_000n - 72_000n).toString());
    expect(detail.schedule[0]).toMatchObject({ state: 'PARTIAL', paid: '90000' });
  });

  it('pays interest before principal on a part-payment', async () => {
    const code = await disbursedLoan('1200000');
    const res = await pay(staff.officer, code, { amount: '10000' }).expect(200);
    expect(res.body.loan.figures.outstandingPrincipal).toBe('1200000');
    expect(res.body.loan.schedule[0].state).toBe('PARTIAL');
    expect(res.body.loan.activity[0].title).toContain('Part payment towards instalment 1');
  });

  it('refuses payments that cannot be right', async () => {
    const code = await disbursedLoan('1200000');
    await pay(staff.officer, code, { amount: '0' }).expect(400);
    await pay(staff.officer, code, { amount: '-5' }).expect(400);
    await pay(staff.officer, code, { amount: '1000.5' }).expect(400);
    await pay(staff.officer, code, { amount: 100000 }).expect(400);
    await pay(staff.officer, code, { amount: '99999999' }).expect(400);
    await pay(staff.officer, code, { amount: '1000', receivedOn: '2999-01-01' }).expect(400);
    await pay(staff.officer, code, { amount: '1000', receivedOn: '2001-01-01' }).expect(400);
    await pay(staff.officer, code, { amount: '1000', idempotencyKey: 'not-a-uuid' }).expect(400);
    await pay(staff.officer, 'LN-9999-2099', { amount: '1000' }).expect(404);

    const ref = `MP-${randomUUID().slice(0, 10)}`;
    await pay(staff.officer, code, { amount: '1000', externalRef: ref }).expect(200);
    await pay(staff.officer, code, { amount: '1000', externalRef: ref }).expect(409);

    const detail = (await get(staff.officer, `/loans/${code}`).expect(200)).body;
    expect(detail.figures.totalRepaid).toBe('1000');
  });

  it('closes the loan when the last franc is paid', async () => {
    const code = await disbursedLoan('600000');
    const before = (await get(staff.officer, `/loans/${code}`).expect(200)).body;
    const res = await pay(staff.officer, code, { amount: before.figures.totalRemaining }).expect(
      200,
    );
    expect(res.body.repaid).toBe(true);
    expect(res.body.loan).toMatchObject({ status: 'REPAID', statusLabel: 'Repaid', next: null });
    expect(res.body.loan.figures).toMatchObject({ outstandingPrincipal: '0', repaidPercent: 100 });
    await pay(staff.officer, code, { amount: '1000' }).expect(409);
  });
});

describe('restructures', () => {
  it('extends the term only after a second person approves', async () => {
    const code = await disbursedLoan('2400000');
    const instalment = calcInstalment(2_400_000n, 1800, 12);
    await pay(staff.officer, code, { amount: instalment.toString() }).expect(200);

    await post(staff.manager, `/loans/${code}/restructures`, {
      type: 'EXTEND_TERM',
      newTermMonths: 11,
      reason: 'Slow season',
    }).expect(400);
    await post(staff.manager, `/loans/${code}/restructures`, {
      type: 'EXTEND_TERM',
      newTermMonths: 18,
    }).expect(400);
    const asked = await post(staff.manager, `/loans/${code}/restructures`, {
      type: 'EXTEND_TERM',
      newTermMonths: 18,
      reason: 'Slow season, orders pick up in January',
    }).expect(201);
    const id: string = asked.body.id;
    expect(asked.body.loan.pendingRestructure).toMatchObject({
      id,
      type: 'EXTEND_TERM',
      newTermMonths: 18,
    });
    // Nothing has changed yet.
    expect(asked.body.loan.terms.instalment).toBe(instalment.toString());
    await post(staff.officer, `/loans/${code}/restructures`, {
      type: 'PAYMENT_HOLIDAY',
      reason: 'Second request',
    }).expect(409);

    await post(staff.manager, `/restructures/${id}/decide`, { approve: true }).expect(403);
    await post(staff.officer, `/restructures/${id}/decide`, { approve: true }).expect(403);
    const loan = (
      await post(staff.manager2, `/restructures/${id}/decide`, { approve: true }).expect(200)
    ).body;

    const outstanding = BigInt(loan.figures.outstandingPrincipal);
    expect(loan.pendingRestructure).toBeNull();
    expect(loan.terms.instalment).toBe(calcInstalment(outstanding, 1800, 18).toString());
    expect(loan.schedule).toHaveLength(19);
    expect(loan.schedule[0].state).toBe('PAID');
    expect(loan.schedule.map((r: { number: number }) => r.number)).toEqual(
      Array.from({ length: 19 }, (_, i) => i + 1),
    );
    const unpaidPrincipal = loan.schedule
      .slice(1)
      .reduce((sum: bigint, r: { principal: string }) => sum + BigInt(r.principal), 0n);
    expect(unpaidPrincipal).toBe(outstanding);
    await post(staff.manager2, `/restructures/${id}/decide`, { approve: false }).expect(409);

    // The loan can still be paid on its new schedule.
    await pay(staff.officer, code, { amount: loan.terms.instalment }).expect(200);
  });

  it('a payment holiday adds one month of interest to the balance', async () => {
    const code = await disbursedLoan('1200000');
    const asked = await post(staff.officer, `/loans/${code}/restructures`, {
      type: 'PAYMENT_HOLIDAY',
      reason: 'Shop closed for repairs',
    }).expect(201);
    const loan = (
      await post(staff.manager, `/restructures/${asked.body.id}/decide`, { approve: true }).expect(
        200,
      )
    ).body;
    const interest = monthlyInterest(1_200_000n, 1800);
    expect(loan.figures.outstandingPrincipal).toBe((1_200_000n + interest).toString());
    expect(loan.schedule).toHaveLength(12);
    expect(loan.schedule[0].dueDate).toBe(addMonths(today, 2));
    expect(loan.terms.instalment).toBe(calcInstalment(1_200_000n + interest, 1800, 12).toString());
  });

  it('a rejected request changes nothing', async () => {
    const code = await disbursedLoan('1200000');
    const before = (await get(staff.officer, `/loans/${code}`).expect(200)).body;
    const asked = await post(staff.officer, `/loans/${code}/restructures`, {
      type: 'EXTEND_TERM',
      newTermMonths: 24,
      reason: 'Asked by the borrower',
    }).expect(201);
    const after = (
      await post(staff.manager, `/restructures/${asked.body.id}/decide`, { approve: false }).expect(
        200,
      )
    ).body;
    expect(after.schedule).toEqual(before.schedule);
    expect(after.terms).toEqual(before.terms);
    expect(after.pendingRestructure).toBeNull();
  });
});

describe('borrowers', () => {
  it('builds the profile from loans, the ledger and the schedule', async () => {
    const a = await newApplication('1200000', { name: 'Profile Person', income: 2_000_000n });
    await post(staff.officer, `/applications/${a.code}/move`, { to: 'UNDER_REVIEW' }).expect(200);
    await post(staff.officer, `/applications/${a.code}/approve`).expect(200);
    const loanCode = (
      await post(staff.manager, `/applications/${a.code}/disburse`, { channel: 'CASH' }).expect(200)
    ).body.loanCode;
    await pay(staff.officer, loanCode, { amount: '100000', channel: 'CASH' }).expect(200);

    const profile = (await get(staff.officer, `/borrowers/${a.borrowerCode}`).expect(200)).body;
    expect(profile).toMatchObject({ name: 'Profile Person', initials: 'PP' });
    expect(profile.contact.phone).toMatch(/^\+250 78• ••• \d{3}$/);
    expect(profile.totals).toMatchObject({ lifetimeBorrowed: '1200000', currentlyOwed: '1118000' });
    expect(profile.loans).toEqual([
      expect.objectContaining({ code: loanCode, statusLabel: 'Active' }),
    ]);
    expect(profile.history.cells).toEqual(Array(6).fill('UPCOMING'));
    expect(profile.debtToIncomeBps).toBe(550);
    expect(profile.aiSummary).toBeNull();
    // The raw phone number never leaves the API.
    expect(JSON.stringify(profile)).not.toMatch(/2507\d{8}/);
  });

  it('adds notes, and keeps their text out of the audit log', async () => {
    const a = await newApplication('500000');
    await post(staff.officer, `/borrowers/${a.borrowerCode}/notes`, { body: '   ' }).expect(400);
    const res = await post(staff.officer, `/borrowers/${a.borrowerCode}/notes`, {
      body: 'Visited the shop. Call her on 0788123412 after 5pm.',
    }).expect(201);
    expect(res.body.notes[0]).toMatchObject({ author: 'E2E L.', createdOn: today });
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'borrower.note.add', entityId: a.borrowerCode },
    });
    expect(JSON.stringify(audit?.metadata)).not.toContain('0788123412');
    expect(JSON.stringify(audit?.metadata)).not.toContain('Visited');
  });

  it('lists and searches', async () => {
    const name = `Zebra ${randomUUID().slice(0, 8)}`;
    const a = await newApplication('500000', { name });
    const list = (await get(staff.officer, `/borrowers?q=${encodeURIComponent(name)}`).expect(200))
      .body;
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ code: a.borrowerCode, name, activeLoans: 0 });
    // Wildcards in the search box are just text.
    expect((await get(staff.officer, '/borrowers?q=%25%25%25').expect(200)).body.total).toBe(0);
    const found = (await get(staff.officer, `/search?q=${encodeURIComponent(name)}`).expect(200))
      .body;
    expect(found.borrowers).toEqual([{ code: a.borrowerCode, name }]);
    expect((await get(staff.officer, '/search?q=a').expect(200)).body).toEqual({
      borrowers: [],
      loans: [],
    });
  });
});

describe('loans list and dashboard', () => {
  it('lists loans with ledger balances, and filters them', async () => {
    const code = await disbursedLoan('1500000');
    const found = (await get(staff.officer, `/loans?q=${code}`).expect(200)).body;
    expect(found.total).toBe(1);
    expect(found.items[0]).toMatchObject({
      code,
      status: 'ACTIVE',
      outstanding: '1500000',
      dpd: 0,
      bucket: 'CURRENT',
      nextDue: addMonths(today, 1),
    });
    const mine = (await get(staff.officer, '/loans?mine=true&status=ACTIVE').expect(200)).body;
    expect(mine.total).toBeGreaterThan(0);
    expect((await get(staff.officer2, '/loans?mine=true').expect(200)).body.total).toBe(0);
    expect(
      (await get(staff.officer, `/loans?q=${code}&bucket=DPD_90_PLUS`).expect(200)).body.total,
    ).toBe(0);
    await get(staff.officer, '/loans?status=NOPE').expect(400);
    await get(staff.officer, '/loans?page=0').expect(400);
  });

  it('shows an overdue loan as late', async () => {
    const code = await disbursedLoan('1200000');
    const loan = await prisma.loan.findFirstOrThrow({ where: { code } });
    // Pretend the first instalment fell due 40 days ago.
    await prisma.scheduleInstalment.updateMany({
      where: { loanId: loan.id, number: 1 },
      data: { dueDate: new Date(Date.now() - 40 * 86_400_000) },
    });
    const detail = (await get(staff.officer, `/loans/${code}`).expect(200)).body;
    expect(detail.dpd).toBeGreaterThanOrEqual(39);
    expect(detail.statusLabel).toMatch(/^Active · \d+ days late$/);
    expect(detail.schedule[0].state).toBe('OVERDUE');
    expect(detail.figures.lateCount).toBe(1);
    const listed = (await get(staff.officer, `/loans?q=${code}&bucket=DPD_31_90`).expect(200)).body;
    expect(listed.total).toBe(1);
  });

  it('gives officers their own book and managers the whole portfolio', async () => {
    await disbursedLoan('1000000');
    const own = (await get(staff.officer, '/dashboard/overview').expect(200)).body;
    const none = (await get(staff.officer2, '/dashboard/overview').expect(200)).body;
    const all = (await get(staff.manager, '/dashboard/overview').expect(200)).body;
    expect(own.scope).toBe('mine');
    expect(all.scope).toBe('all');
    expect(none.metrics).toMatchObject({ activePortfolio: '0', activeLoans: 0 });
    expect(BigInt(own.metrics.activePortfolio)).toBeGreaterThan(0n);
    expect(BigInt(all.metrics.activePortfolio)).toBeGreaterThanOrEqual(
      BigInt(own.metrics.activePortfolio),
    );
    expect(own.series).toHaveLength(12);
    expect(BigInt(own.series[11].disbursed)).toBeGreaterThan(0n);
    expect(own.metrics.loansThisMonth).toBeGreaterThan(0);
    expect(own.recentApplications.length).toBeGreaterThan(0);
    expect(own.recentApplications.length).toBeLessThanOrEqual(5);
  });

  it('keeps notifications per person', async () => {
    await prisma.notification.create({
      data: { userId: staff.officer.id, kind: 'SYSTEM', title: 'For the first officer only' },
    });
    const mine = (await get(staff.officer, '/notifications').expect(200)).body;
    expect(mine.unread).toBe(1);
    expect((await get(staff.officer2, '/notifications').expect(200)).body.items).toEqual([]);
    await post(staff.officer, '/notifications/read-all').expect(204);
    expect((await get(staff.officer, '/notifications').expect(200)).body.unread).toBe(0);
  });
});

describe('the books', () => {
  it('still balance after everything above', async () => {
    const rows = await prisma.$queryRaw<Array<{ debits: bigint; credits: bigint }>>`
      SELECT COALESCE(SUM("amount") FILTER (WHERE "direction" = 'DEBIT'), 0)::bigint AS debits,
             COALESCE(SUM("amount") FILTER (WHERE "direction" = 'CREDIT'), 0)::bigint AS credits
      FROM "LedgerEntry"`;
    expect(rows[0]!.debits).toBe(rows[0]!.credits);
    expect(rows[0]!.debits).toBeGreaterThan(0n);

    // And each loan's instalments agree with its ledger balance.
    const mismatched = await prisma.$queryRaw<Array<{ code: string }>>`
      SELECT l."code"
      FROM "Loan" l
      JOIN LATERAL (
        SELECT COALESCE(SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE -e."amount" END), 0) AS ledger
        FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a."id" = e."accountId"
        WHERE e."loanId" = l."id" AND a."code" = '1100'
      ) bal ON TRUE
      JOIN LATERAL (
        SELECT COALESCE(SUM(i."principalDue" - i."principalPaid"), 0) AS schedule
        FROM "ScheduleInstalment" i WHERE i."loanId" = l."id" AND i."supersededAt" IS NULL
      ) due ON TRUE
      WHERE bal.ledger <> due.schedule`;
    expect(mismatched).toEqual([]);
  });
});
