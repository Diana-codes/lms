import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { addDays, calcInstalment, kigaliDate, legacyTerms } from '@kora/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import type { StaffRole } from '../src/generated/prisma/client';
import { JobsService } from '../src/jobs/jobs.service';
import { ACCOUNTS } from '../src/ledger/accounts';
import { MomoSimulator } from '../src/providers/momo.simulator';
import type { PrismaClient } from '../src/generated/prisma/client';
import { runAsCompany } from '../src/tenancy/company-context';
import { signInWithSms, smsTwoFactor } from './sign-in';
import { testPrisma, byCode, E2E_COMPANY_ID } from './test-db';

/**
 * Phase 2: money through MoMo, SMS, collections and the nightly job, against
 * the local simulators (no provider keys in the test environment).
 */
const PASSWORD = `e2e-${randomUUID()}`;
const PRODUCT = `E2E2-${randomUUID().slice(0, 8)}`;
const today = kigaliDate();

let app: INestApplication;
let prisma: PrismaClient;
type Agent = { cookies: string[]; id: string };
const staff = {} as Record<'officer' | 'manager' | 'collections', Agent>;

const http = () => request(app.getHttpServer());
const get = (who: Agent, path: string) => http().get(path).set('Cookie', who.cookies);
const post = (who: Agent, path: string, body: object = {}) =>
  http().post(path).set('Cookie', who.cookies).send(body);
const phone = (suffix = '') =>
  `078${randomInt(10_000, 99_999)}${suffix || String(randomInt(10, 98)).padStart(2, '0')}`;

async function signIn(role: StaffRole, hash: string): Promise<Agent> {
  const email = `e2e-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
  const factor = smsTwoFactor();
  const user = await prisma.user.create({
    data: { email, passwordHash: hash, firstName: 'E2E', lastName: role, role, ...factor },
  });
  const res = await signInWithSms(app, { email, phone: factor.phone }, PASSWORD);
  return {
    cookies: ([] as string[]).concat(res.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]!),
    id: user.id,
  };
}

/** An approved application for a borrower with the given phone. */
async function approved(amount: string, number: string) {
  const res = await post(staff.officer, '/applications', {
    name: `MoMo Test ${randomUUID().slice(0, 5)}`,
    phone: number,
    productCode: PRODUCT,
    amount,
    termMonths: 12,
  }).expect(201);
  await prisma.borrower.update({
    where: byCode(res.body.borrowerCode),
    data: { momoLinked: true },
  });
  await post(staff.officer, `/applications/${res.body.code}/move`, { to: 'UNDER_REVIEW' }).expect(
    200,
  );
  await post(staff.officer, `/applications/${res.body.code}/approve`).expect(200);
  return res.body as { code: string; borrowerCode: string };
}

async function activeLoan(number = phone()): Promise<string> {
  const a = await approved('1200000', number);
  const res = await post(staff.manager, `/applications/${a.code}/disburse`, {
    channel: 'BANK_TRANSFER',
  }).expect(200);
  return res.body.loanCode as string;
}

beforeAll(async () => {
  MomoSimulator.settleAfterMs = 0;
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
      name: 'E2E MoMo product',
      shortName: 'E2E',
      kind: 'PERSONAL',
      terms: legacyTerms(1800) as object,
      annualRateBps: 1800,
      minTermMonths: 3,
      maxTermMonths: 36,
      minAmount: 100_000n,
      maxAmount: 50_000_000n,
    },
  });
  const hash = await hashPassword(PASSWORD);
  staff.officer = await signIn('LOAN_OFFICER', hash);
  staff.manager = await signIn('MANAGER', hash);
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

describe('MoMo request to pay', () => {
  it('posts the payment only once the provider confirms it', async () => {
    const code = await activeLoan();
    const instalment = calcInstalment(1_200_000n, 1800, 12);
    const asked = await post(staff.collections, `/loans/${code}/momo-request`, {
      amount: instalment.toString(),
    }).expect(202);
    expect(asked.body.status).toBe('PENDING');

    // Nothing has moved yet.
    let detail = (await get(staff.officer, `/loans/${code}`).expect(200)).body;
    expect(detail.figures.totalRepaid).toBe('0');
    expect(detail.pendingPayments).toHaveLength(1);
    await post(staff.collections, `/loans/${code}/momo-request`, { amount: '1000' }).expect(409);

    const checked = await post(staff.collections, `/payments/${asked.body.paymentId}/check`).expect(
      200,
    );
    expect(checked.body.status).toBe('SUCCESSFUL');
    detail = (await get(staff.officer, `/loans/${code}`).expect(200)).body;
    expect(detail.figures.totalRepaid).toBe(instalment.toString());
    expect(detail.schedule[0].state).toBe('PAID');
    expect(detail.pendingPayments).toHaveLength(0);
    expect(detail.activity[0].title).toBe('Instalment 1 received via MoMo');

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: asked.body.paymentId } });
    expect(payment.status).toBe('SUCCESSFUL');
    expect(payment.externalRef).toMatch(/^SIM/);
    expect(payment.recordedById).toBe(staff.collections.id);
    // The borrower gets a receipt by SMS.
    const sms = await prisma.smsMessage.findFirst({
      where: { loanId: payment.loanId, template: 'payment.received' },
    });
    expect(sms?.status).toBe('DELIVERED');
    expect(sms?.body).toContain(code);
  });

  it('counts a confirmation delivered many times at once exactly once', async () => {
    const code = await activeLoan();
    const asked = await post(staff.officer, `/loans/${code}/momo-request`, {
      amount: '50000',
    }).expect(202);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        post(staff.officer, `/payments/${asked.body.paymentId}/check`),
      ),
    );
    expect(results.map((r) => r.body.status)).toEqual(Array(6).fill('SUCCESSFUL'));
    const detail = (await get(staff.officer, `/loans/${code}`).expect(200)).body;
    expect(detail.figures.totalRepaid).toBe('50000');
    const loan = await prisma.loan.findFirstOrThrow({ where: { code } });
    expect(await prisma.payment.count({ where: { loanId: loan.id, status: 'SUCCESSFUL' } })).toBe(
      1,
    );
  });

  it('records a declined request as failed, with nothing posted', async () => {
    const code = await activeLoan(phone('00'));
    const asked = await post(staff.officer, `/loans/${code}/momo-request`, {
      amount: '50000',
    }).expect(202);
    const checked = await post(staff.officer, `/payments/${asked.body.paymentId}/check`).expect(
      200,
    );
    expect(checked.body.status).toBe('FAILED');
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: asked.body.paymentId } });
    expect(payment.failureReason).toContain('declined');
    expect((await get(staff.officer, `/loans/${code}`).expect(200)).body.figures.totalRepaid).toBe(
      '0',
    );
    // After a failure, a new request can be made.
    await post(staff.officer, `/loans/${code}/momo-request`, { amount: '50000' }).expect(202);
  });

  it('stays pending while the borrower has not answered, and the poller follows up', async () => {
    const code = await activeLoan(phone('99'));
    const asked = await post(staff.officer, `/loans/${code}/momo-request`, {
      amount: '50000',
    }).expect(202);
    expect(
      (await post(staff.officer, `/payments/${asked.body.paymentId}/check`).expect(200)).body
        .status,
    ).toBe('PENDING');
    const polled = await post(staff.manager, '/jobs/poll-momo').expect(200);
    expect(polled.body.payments).toBeGreaterThanOrEqual(1);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: asked.body.paymentId } })).status,
    ).toBe('PENDING');
  });

  it('refuses amounts the loan does not owe', async () => {
    const code = await activeLoan();
    await post(staff.officer, `/loans/${code}/momo-request`, { amount: '99999999' }).expect(400);
    await post(staff.officer, `/loans/${code}/momo-request`, { amount: '0' }).expect(400);
  });
});

describe('MoMo disbursement', () => {
  it('activates the loan and posts the ledger only when the transfer is confirmed', async () => {
    const a = await approved('2000000', phone());
    const res = await post(staff.manager, `/applications/${a.code}/disburse`, {
      channel: 'MTN_MOMO',
    }).expect(200);
    expect(res.body.status).toBe('SUCCESSFUL');
    const loanCode: string = res.body.loanCode;
    expect(res.body.application.stage).toBe('DISBURSED');
    expect(res.body.application.statusNote).toBe('Sent via MoMo');

    const detail = (await get(staff.officer, `/loans/${loanCode}`).expect(200)).body;
    expect(detail.status).toBe('ACTIVE');
    expect(detail.terms.disbursedOn).toBe(today);
    expect(detail.terms.channel).toBe('MTN MoMo');
    expect(detail.figures.outstandingPrincipal).toBe('2000000');
    const d = await prisma.disbursement.findFirstOrThrow({ where: { loan: { code: loanCode } } });
    expect(d.status).toBe('SUCCESSFUL');
    expect(d.ledgerTransactionId).not.toBeNull();
    expect(d.externalRef).toMatch(/^SIM/);
    const sms = await prisma.smsMessage.findFirst({
      where: { loanId: d.loanId, template: 'disbursement.sent' },
    });
    expect(sms?.body).toContain('RWF 2,000,000');
    await post(staff.manager, `/applications/${a.code}/disburse`, { channel: 'MTN_MOMO' }).expect(
      409,
    );
  });

  it('leaves a failed transfer as a pending loan with no ledger entry, and lets a manager retry', async () => {
    const a = await approved('1500000', phone('00'));
    const res = await post(staff.manager, `/applications/${a.code}/disburse`, {
      channel: 'MTN_MOMO',
    }).expect(200);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.application.stage).toBe('APPROVED');
    expect(res.body.application.statusNote).toContain('failed');
    expect(res.body.application.disbursement.status).toBe('FAILED');
    const loan = await prisma.loan.findFirstOrThrow({ where: { code: res.body.loanCode } });
    expect(loan.status).toBe('PENDING_DISBURSEMENT');
    expect(await prisma.ledgerTransaction.count({ where: { loanId: loan.id } })).toBe(0);
    expect(
      (await get(staff.officer, '/loans?status=ACTIVE&q=' + loan.code).expect(200)).body.total,
    ).toBe(0);

    // The borrower fixes their wallet; the manager tries again.
    await prisma.borrower.update({ where: byCode(a.borrowerCode), data: { phone: phone() } });
    const retry = await post(staff.manager, `/applications/${a.code}/disburse`, {
      channel: 'MTN_MOMO',
    }).expect(200);
    expect(retry.body.status).toBe('SUCCESSFUL');
    expect(retry.body.loanCode).toBe(loan.code);
    expect((await prisma.loan.findUniqueOrThrow({ where: { id: loan.id } })).status).toBe('ACTIVE');
    expect(
      await prisma.ledgerTransaction.count({ where: { loanId: loan.id, type: 'DISBURSEMENT' } }),
    ).toBe(1);
  });

  it('needs a linked MoMo wallet', async () => {
    const a = await approved('500000', phone());
    await prisma.borrower.update({ where: byCode(a.borrowerCode), data: { momoLinked: false } });
    const res = await post(staff.manager, `/applications/${a.code}/disburse`, {
      channel: 'MTN_MOMO',
    }).expect(409);
    expect(res.body.message).toContain('no MoMo wallet');
  });
});

describe('webhooks', () => {
  it('reject a wrong token and accept the right one', async () => {
    await http()
      .post('/webhooks/momo/collection/wrong-token')
      .send({ referenceId: randomUUID() })
      .expect(401);
    await http()
      .post('/webhooks/sms/delivery/wrong-token')
      .send({ id: 'x', status: 'Success' })
      .expect(401);
    const token = process.env.WEBHOOK_TOKEN;
    if (token) {
      await http()
        .post(`/webhooks/momo/collection/${token}`)
        .send({ referenceId: randomUUID() })
        .expect(200);
    }
  });

  it('a callback confirms a pending payment through a fresh status check', async () => {
    const token = process.env.WEBHOOK_TOKEN;
    if (!token) return;
    const code = await activeLoan();
    const asked = await post(staff.officer, `/loans/${code}/momo-request`, {
      amount: '40000',
    }).expect(202);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: asked.body.paymentId } });
    // The body claims FAILED, but the status check with the provider says SUCCESSFUL. The check wins.
    await http()
      .post(`/webhooks/momo/collection/${token}`)
      .send({ referenceId: payment.idempotencyKey.slice(5), status: 'FAILED' })
      .expect(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'SUCCESSFUL',
    );
  });
});

describe('SMS', () => {
  it('sends a message to a borrower and logs it against the loan', async () => {
    const code = await activeLoan();
    const loan = await prisma.loan.findFirstOrThrow({
      where: { code },
      include: { borrower: true },
    });
    const res = await post(staff.collections, `/borrowers/${loan.borrower.code}/sms`, {
      body: 'Hello from the e2e test.',
      loanCode: code,
    }).expect(201);
    expect(res.body.status).toBe('DELIVERED');
    const contact = await prisma.contactLog.findFirst({
      where: { loanId: loan.id, channel: 'SMS' },
    });
    expect(contact?.summary).toBe('SMS sent');
    await post(staff.collections, `/borrowers/${loan.borrower.code}/sms`, { body: '' }).expect(400);
    await post(staff.collections, `/borrowers/${loan.borrower.code}/sms`, {
      body: 'x'.repeat(481),
    }).expect(400);
  });

  it('records a failed send instead of pretending', async () => {
    const code = await activeLoan(phone('00'));
    const loan = await prisma.loan.findFirstOrThrow({
      where: { code },
      include: { borrower: true },
    });
    const res = await post(staff.officer, `/borrowers/${loan.borrower.code}/sms`, {
      body: 'Will fail',
    }).expect(201);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.failureReason).toBeTruthy();
  });

  it('sends due-soon reminders once, not twice', async () => {
    const code = await activeLoan();
    const loan = await prisma.loan.findFirstOrThrow({ where: { code } });
    await prisma.scheduleInstalment.updateMany({
      where: { loanId: loan.id, number: 1 },
      data: { dueDate: new Date(Date.now() + 2 * 86_400_000) },
    });
    const first = await post(staff.officer, '/sms/reminders', { days: 7 }).expect(200);
    expect(first.body.sent).toBeGreaterThanOrEqual(1);
    const second = await post(staff.officer, '/sms/reminders', { days: 7 }).expect(200);
    expect(second.body.sent).toBe(0);
    const sms = await prisma.smsMessage.findMany({
      where: { loanId: loan.id, template: 'reminder.due_soon' },
    });
    expect(sms).toHaveLength(1);
    expect(sms[0]!.body).toMatch(/is due on \d+ \w+\./);
  });
});

describe('collections', () => {
  /** A loan whose first instalment fell due `days` ago. */
  async function lateLoan(days: number): Promise<string> {
    const code = await activeLoan();
    const loan = await prisma.loan.findFirstOrThrow({ where: { code } });
    await prisma.scheduleInstalment.updateMany({
      where: { loanId: loan.id, number: 1 },
      data: { dueDate: new Date(Date.now() - days * 86_400_000) },
    });
    return code;
  }

  it('lists overdue accounts with buckets, balances and next steps', async () => {
    const code = await lateLoan(45);
    const q = (await get(staff.collections, '/collections').expect(200)).body;
    const item = q.items.find((i: { loanCode: string }) => i.loanCode === code);
    expect(item).toMatchObject({
      bucket: 'DPD_31_90',
      outstanding: '1200000',
      nextActionLabel: 'Call',
      lastContact: 'No contact yet',
    });
    expect(item.dpd).toBeGreaterThanOrEqual(44);
    expect(BigInt(item.overdue)).toBe(calcInstalment(1_200_000n, 1800, 12));
    expect(item.phone).toMatch(/^\+250 78• ••• \d{3}$/);
    expect(q.metrics.inArrears).toBeGreaterThan(0);
    expect(q.buckets.DPD_31_90).toBeGreaterThan(0);
  });

  it('logs outcomes, records promises and sets the next step', async () => {
    const code = await lateLoan(10);
    const promised = addDays(today, 5);
    await post(staff.collections, `/collections/accounts/${code}/outcome`, {
      outcome: 'PROMISED_TO_PAY',
    }).expect(400);
    await post(staff.collections, `/collections/accounts/${code}/outcome`, {
      outcome: 'PROMISED_TO_PAY',
      date: promised,
    }).expect(400);
    const res = await post(staff.collections, `/collections/accounts/${code}/outcome`, {
      outcome: 'PROMISED_TO_PAY',
      date: promised,
      amount: '150000',
    }).expect(200);
    expect(res.body.promise).toEqual({ amount: '150000', date: promised });
    expect(res.body.log[0].text).toMatch(/^Promised to pay RWF 150,000 on/);
    expect(res.body.log[0].when).toContain('E2E C.');

    const item = (await get(staff.collections, '/collections').expect(200)).body.items.find(
      (i: { loanCode: string }) => i.loanCode === code,
    );
    expect(item.nextActionLabel).toMatch(/^Follow up/);
    expect(item.lastContact).toMatch(/^Promised/);

    await post(staff.collections, `/collections/accounts/${code}/outcome`, {
      outcome: 'NO_ANSWER',
      date: addDays(today, 1),
    }).expect(200);
    await post(staff.collections, `/collections/accounts/${code}/outcome`, {
      outcome: 'DISPUTED',
    }).expect(200);
    const alert = await prisma.notification.findFirst({
      where: { userId: staff.manager.id, title: { contains: code } },
    });
    expect(alert).not.toBeNull();
    await post(staff.collections, `/collections/accounts/${code}/outcome`, {
      outcome: 'NO_ANSWER',
      date: addDays(today, -1),
    }).expect(400);
  });

  it('bulk SMS texts a bucket once a day, and managers can assign accounts', async () => {
    await lateLoan(100);
    const first = await post(staff.collections, '/collections/bulk-sms', {
      bucket: 'DPD_90_PLUS',
    }).expect(200);
    expect(first.body.sent).toBeGreaterThanOrEqual(1);
    const second = await post(staff.collections, '/collections/bulk-sms', {
      bucket: 'DPD_90_PLUS',
    }).expect(200);
    expect(second.body.sent).toBe(0);
    await post(staff.collections, '/collections/assign').expect(403);
    const assigned = await post(staff.manager, '/collections/assign').expect(200);
    expect(assigned.body.assigned).toBeGreaterThanOrEqual(0);
    expect(
      await prisma.collectionCase.count({ where: { closedAt: null, assignedToId: null } }),
    ).toBe(0);
  });

  it('a payment that clears the arrears closes the case', async () => {
    const code = await lateLoan(20);
    await post(staff.collections, `/collections/accounts/${code}/outcome`, {
      outcome: 'REACHED',
      note: 'Will pay today',
    }).expect(200);
    const loan = await prisma.loan.findFirstOrThrow({ where: { code } });
    expect(await prisma.collectionCase.count({ where: { loanId: loan.id, closedAt: null } })).toBe(
      1,
    );
    const detail = (await get(staff.officer, `/loans/${code}`).expect(200)).body;
    await post(staff.officer, `/loans/${code}/payments`, {
      amount: detail.figures.totalRemaining,
      channel: 'CASH',
      receivedOn: today,
      idempotencyKey: randomUUID(),
    }).expect(200);
    expect(await prisma.collectionCase.count({ where: { loanId: loan.id, closedAt: null } })).toBe(
      0,
    );
  });
});

describe('the nightly job', () => {
  it('opens cases for new arrears, closes cleared ones, and marks broken promises', async () => {
    const code = await activeLoan();
    const loan = await prisma.loan.findFirstOrThrow({ where: { code } });
    await prisma.scheduleInstalment.updateMany({
      where: { loanId: loan.id, number: 1 },
      data: { dueDate: new Date(Date.now() - 3 * 86_400_000) },
    });
    await prisma.promiseToPay.create({
      data: { loanId: loan.id, amount: 1000n, promisedFor: new Date(Date.now() - 86_400_000) },
    });

    const summary = await runAsCompany(E2E_COMPANY_ID, () => app.get(JobsService).nightly());
    expect(summary.casesOpened).toBeGreaterThanOrEqual(1);
    expect(summary.promisesBroken).toBeGreaterThanOrEqual(1);
    const opened = await prisma.collectionCase.findFirst({
      where: { loanId: loan.id, closedAt: null },
    });
    expect(opened?.nextAction).toBe('SMS');
    expect((await prisma.promiseToPay.findFirst({ where: { loanId: loan.id } }))?.status).toBe(
      'BROKEN',
    );

    // Paying brings it current; the next run closes the case.
    const detail = (await get(staff.officer, `/loans/${code}`).expect(200)).body;
    await post(staff.officer, `/loans/${code}/payments`, {
      amount: detail.next.amount,
      channel: 'CASH',
      receivedOn: today,
      idempotencyKey: randomUUID(),
    }).expect(200);
    const again = await runAsCompany(E2E_COMPANY_ID, () => app.get(JobsService).nightly());
    expect(again.casesClosed).toBeGreaterThanOrEqual(1);
    expect(await prisma.collectionCase.count({ where: { loanId: loan.id, closedAt: null } })).toBe(
      0,
    );
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'system.nightly' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.actorType).toBe('SYSTEM');
    await post(staff.collections, '/jobs/nightly').expect(403);
  });
});

describe('the books', () => {
  it('still balance, and every active loan agrees with its schedule', async () => {
    const rows = await prisma.$queryRaw<Array<{ debits: bigint; credits: bigint }>>`
      SELECT COALESCE(SUM("amount") FILTER (WHERE "direction" = 'DEBIT'), 0)::bigint AS debits,
             COALESCE(SUM("amount") FILTER (WHERE "direction" = 'CREDIT'), 0)::bigint AS credits FROM "LedgerEntry"`;
    expect(rows[0]!.debits).toBe(rows[0]!.credits);
    const mismatched = await prisma.$queryRaw<Array<{ code: string }>>`
      SELECT l."code" FROM "Loan" l
      JOIN LATERAL (SELECT COALESCE(SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE -e."amount" END), 0) AS ledger
        FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a."id" = e."accountId" WHERE e."loanId" = l."id" AND a."code" = '1100') bal ON TRUE
      JOIN LATERAL (SELECT COALESCE(SUM(i."principalDue" - i."principalPaid"), 0) AS schedule
        FROM "ScheduleInstalment" i WHERE i."loanId" = l."id" AND i."supersededAt" IS NULL) due ON TRUE
      WHERE l."status" NOT IN ('PENDING_DISBURSEMENT', 'WRITTEN_OFF') AND bal.ledger <> due.schedule`;
    expect(mismatched).toEqual([]);
  });
});
