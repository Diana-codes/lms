import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { addDays, isoToUtcDate, kigaliDate } from '@kora/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGREEMENT_VERSION } from '../src/agreements/template';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import type { StaffRole } from '../src/generated/prisma/client';
import { PenaltiesService } from '../src/loans/penalties.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Fees, late penalties and loan agreements: the borrower signs Key Facts,
 * the fee comes out of the payout, penalties follow the signed terms, and a
 * manager can waive one. Every step is checked against the ledger.
 */
const PASSWORD = `e2e-${randomUUID()}`;
const PRODUCT = `E2EF-${randomUUID().slice(0, 8)}`;
const today = kigaliDate();

let app: INestApplication;
let prisma: PrismaService;
let penalties: PenaltiesService;
type Agent = { cookies: string[]; id: string };
const staff = {} as Record<'officer' | 'manager', Agent>;

const http = () => request(app.getHttpServer());
const phone = () => `078${randomInt(1_000_000, 9_999_999)}`;
const get = (who: Agent, path: string) => http().get(path).set('Cookie', who.cookies);
const post = (who: Agent, path: string, body: object = {}) =>
  http().post(path).set('Cookie', who.cookies).send(body);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function signIn(role: StaffRole, passwordHash: string): Promise<Agent> {
  const email = `e2e-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
  const user = await prisma.user.create({
    data: { email, passwordHash, firstName: 'E2E', lastName: role, role },
  });
  const res = await http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
  const cookies = ([] as string[]).concat(res.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]!);
  return { cookies, id: user.id };
}

async function signInBorrower(number: string): Promise<string> {
  await http().post('/app/auth/request-code').send({ phone: number }).expect(200);
  const e164 = `+250${number.slice(1)}`;
  const challenge = await prisma.otpChallenge.findFirstOrThrow({
    where: { phone: e164 },
    orderBy: { createdAt: 'desc' },
  });
  let code = '';
  for (let i = 0; i < 1_000_000; i++) {
    const c = String(i).padStart(6, '0');
    if (createHash('sha256').update(`${e164}:${c}`).digest('base64url') === challenge.codeHash) {
      code = c;
      break;
    }
  }
  const res = await http().post('/app/auth/verify').send({ phone: number, code }).expect(200);
  return res.body.accessToken as string;
}

/** An approved application for the test product, not yet signed. */
async function approved(amount = '4500000', number = phone()) {
  const res = await post(staff.officer, '/applications', {
    name: `Fee Test ${randomUUID().slice(0, 5)}`,
    phone: number,
    productCode: PRODUCT,
    amount,
    termMonths: 18,
  }).expect(201);
  await post(staff.officer, `/applications/${res.body.code}/move`, { to: 'UNDER_REVIEW' }).expect(
    200,
  );
  await post(staff.officer, `/applications/${res.body.code}/approve`).expect(200);
  return res.body as { code: string; borrowerCode: string };
}

async function entriesFor(idempotencyKey: string) {
  const tx = await prisma.ledgerTransaction.findUniqueOrThrow({
    where: { idempotencyKey },
    include: { entries: { include: { account: true } } },
  });
  return Object.fromEntries(
    tx.entries.map((e) => [`${e.account.code} ${e.direction}`, e.amount]),
  ) as Record<string, bigint>;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  prisma = app.get(PrismaService);
  penalties = app.get(PenaltiesService);
  await prisma.product.create({
    data: {
      code: PRODUCT,
      name: 'E2E fee product',
      shortName: 'E2E fee',
      kind: 'SME',
      annualRateBps: 1700,
      minTermMonths: 6,
      maxTermMonths: 24,
      minAmount: 500_000n,
      maxAmount: 6_000_000n,
      originationFeeBps: 150,
      latePenaltyBps: 200,
      penaltyGraceDays: 5,
      requiredDocuments: [],
    },
  });
  const hash = await hashPassword(PASSWORD);
  staff.officer = await signIn('LOAN_OFFICER', hash);
  staff.manager = await signIn('MANAGER', hash);
});

afterAll(async () => {
  await prisma.product.updateMany({ where: { code: PRODUCT }, data: { isActive: false } });
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-' } },
    data: { isActive: false },
  });
  await app.close();
});

describe('agreement and fee', () => {
  it('is signed before payout, and the fee comes out of what is sent', async () => {
    const a = await approved();

    // A copy to print and sign, before anything is recorded.
    const draft = await get(staff.officer, `/applications/${a.code}/agreement.pdf`)
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(draft.headers['content-type']).toBe('application/pdf');
    expect((draft.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    let card = (await get(staff.officer, `/applications/${a.code}`).expect(200)).body;
    expect(card).toMatchObject({ agreement: null, fee: '67500' });

    await post(staff.manager, `/applications/${a.code}/disburse`, {
      channel: 'BANK_TRANSFER',
    }).expect(409);
    const signed = await post(staff.officer, `/applications/${a.code}/agreement`).expect(200);
    expect(signed.body).toMatchObject({
      signed: true,
      channel: 'BRANCH',
      version: AGREEMENT_VERSION,
    });
    expect(signed.body.terms).toMatchObject({
      principal: '4500000',
      fee: '67500',
      netDisbursed: '4432500',
      instalment: '284985',
      aprBps: 1902,
      latePenaltyBps: 200,
      penaltyGraceDays: 5,
    });
    card = (await get(staff.officer, `/applications/${a.code}`).expect(200)).body;
    expect(card.agreement.channel).toBe('BRANCH');

    // The signed agreement is evidence: the database refuses to change it.
    const agreement = await prisma.loanAgreement.findFirstOrThrow({
      where: { application: { code: a.code } },
    });
    expect(agreement.bodyHash).toBe(createHash('sha256').update(agreement.body).digest('hex'));
    expect(agreement.body).toContain('Annual percentage rate (APR), including fees | 19.02%');
    await expect(
      prisma.loanAgreement.update({ where: { id: agreement.id }, data: { body: 'changed' } }),
    ).rejects.toThrow();

    const res = await post(staff.manager, `/applications/${a.code}/disburse`, {
      channel: 'BANK_TRANSFER',
    }).expect(200);
    const loan = await prisma.loan.findUniqueOrThrow({
      where: { code: res.body.loanCode },
      include: { disbursements: true },
    });
    expect(loan).toMatchObject({
      principal: 4_500_000n,
      feeAmount: 67_500n,
      latePenaltyBps: 200,
      penaltyGraceDays: 5,
    });
    expect(loan.disbursements[0]!.amount).toBe(4_432_500n);
    expect(await entriesFor(`disbursement:${a.code}`)).toEqual({
      '1100 DEBIT': 4_500_000n,
      '1000 CREDIT': 4_432_500n,
      '4010 CREDIT': 67_500n,
    });

    const detail = (await get(staff.officer, `/loans/${loan.code}`).expect(200)).body;
    expect(detail.terms).toMatchObject({
      fee: '67500',
      netDisbursed: '4432500',
      latePenaltyBps: 200,
    });
    expect(detail.agreement).toMatchObject({ applicationCode: a.code, channel: 'BRANCH' });
  });

  it('is accepted in the app, with the Key Facts shown first', async () => {
    const number = phone();
    const old = await approved('1000000', number);
    await prisma.application.update({ where: { code: old.code }, data: { stage: 'WITHDRAWN' } });
    const token = await signInBorrower(number);

    const quote = (
      await http()
        .get(`/app/apply/quote?productCode=${PRODUCT}&amount=4500000&termMonths=18`)
        .set(bearer(token))
        .expect(200)
    ).body;
    expect(quote).toMatchObject({ fee: '67500', youReceive: '4432500', aprBps: 1902 });

    const preview = (
      await http()
        .get(`/app/apply/agreement?productCode=${PRODUCT}&amount=4500000&termMonths=18`)
        .set(bearer(token))
        .expect(200)
    ).body;
    expect(preview.version).toBe(AGREEMENT_VERSION);
    expect(preview.keyFacts).toContainEqual({
      label: 'You receive in your MoMo wallet',
      value: 'RWF 4,432,500',
    });
    expect(preview.body).toContain('DRAFT FOR LEGAL REVIEW');

    const apply = (version: string) =>
      http().post('/app/apply').set(bearer(token)).send({
        productCode: PRODUCT,
        amount: '4500000',
        termMonths: 18,
        purpose: 'Stock',
        agreedTerms: true,
        agreementVersion: version,
      });
    const stale = await apply('2020-01-old').expect(409);
    expect(stale.body.message).toBe('The loan agreement has changed. Please read it again.');
    const created = await apply(AGREEMENT_VERSION).expect(201);

    const signed = await prisma.loanAgreement.findFirstOrThrow({
      where: { application: { code: created.body.code } },
    });
    expect(signed).toMatchObject({ channel: 'APP', templateVersion: AGREEMENT_VERSION });
    expect(signed.body).toContain(created.body.code);

    // Paid out, the borrower can download what they signed; nobody else can.
    await post(staff.officer, `/applications/${created.body.code}/move`, {
      to: 'UNDER_REVIEW',
    }).expect(200);
    await post(staff.officer, `/applications/${created.body.code}/approve`).expect(200);
    await post(staff.officer, `/applications/${created.body.code}/agreement`).expect(409);
    const loanCode = (
      await post(staff.manager, `/applications/${created.body.code}/disburse`, {
        channel: 'CASH',
      }).expect(200)
    ).body.loanCode as string;
    const pdf = await http()
      .get(`/app/loans/${loanCode}/agreement.pdf`)
      .set(bearer(token))
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const stranger = phone();
    await approved('600000', stranger);
    await http()
      .get(`/app/loans/${loanCode}/agreement.pdf`)
      .set(bearer(await signInBorrower(stranger)))
      .expect(404);
  });
});

describe('late penalties', () => {
  it('follow the signed terms, can be waived, and are paid first', async () => {
    const a = await approved();
    await post(staff.officer, `/applications/${a.code}/agreement`).expect(200);
    const loanCode = (
      await post(staff.manager, `/applications/${a.code}/disburse`, {
        channel: 'BANK_TRANSFER',
      }).expect(200)
    ).body.loanCode as string;
    const loan = await prisma.loan.findUniqueOrThrow({
      where: { code: loanCode },
      include: { instalments: { orderBy: { number: 'asc' } } },
    });
    const first = loan.instalments[0]!;

    // Five days late: still within the grace period.
    await prisma.scheduleInstalment.update({
      where: { id: first.id },
      data: { dueDate: isoToUtcDate(addDays(today, -5)) },
    });
    await penalties.chargeDue(today);
    expect(await prisma.penaltyCharge.count({ where: { loanId: loan.id } })).toBe(0);

    // Six days late: 2% of the instalment, once, however often the job runs.
    await prisma.scheduleInstalment.update({
      where: { id: first.id },
      data: { dueDate: isoToUtcDate(addDays(today, -6)) },
    });
    await penalties.chargeDue(today);
    await penalties.chargeDue(today);
    const charges = await prisma.penaltyCharge.findMany({ where: { loanId: loan.id } });
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({ sequence: 1, base: 284_985n, amount: 5_700n });
    expect(await entriesFor(`penalty:${first.id}:1`)).toEqual({
      '1120 DEBIT': 5_700n,
      '4020 CREDIT': 5_700n,
    });

    // 36 days late: the second monthly charge.
    await prisma.scheduleInstalment.update({
      where: { id: first.id },
      data: { dueDate: isoToUtcDate(addDays(today, -36)) },
    });
    await penalties.chargeDue(today);
    let detail = (await get(staff.officer, `/loans/${loanCode}`).expect(200)).body;
    expect(detail.penalties).toHaveLength(2);
    expect(detail.penaltiesOwed).toBe('11400');
    expect(detail.schedule[0]).toMatchObject({
      penalty: '11400',
      remaining: String(284_985 + 11_400),
    });

    // Restructuring waits until penalties are collected or waived.
    const blocked = await post(staff.officer, `/loans/${loanCode}/restructures`, {
      type: 'EXTEND_TERM',
      newTermMonths: 24,
      reason: 'Slow season',
    }).expect(409);
    expect(blocked.body.message).toBe(
      'Collect or waive the RWF 11,400 in late penalties before restructuring',
    );

    // Only a manager waives, with a reason.
    const second = detail.penalties[1].id as string;
    await post(staff.officer, `/loans/${loanCode}/penalties/${second}/waive`, {
      reason: 'Hospital stay',
    }).expect(403);
    await post(staff.manager, `/loans/${loanCode}/penalties/${second}/waive`, {
      reason: 'no',
    }).expect(400);
    detail = (
      await post(staff.manager, `/loans/${loanCode}/penalties/${second}/waive`, {
        reason: 'Borrower was in hospital; paid as soon as discharged',
      }).expect(200)
    ).body;
    expect(detail.penaltiesOwed).toBe('5700');
    expect(detail.penalties[1]).toMatchObject({ waivedAmount: '5700', canWaive: false });
    await post(staff.manager, `/loans/${loanCode}/penalties/${second}/waive`, {
      reason: 'Again by mistake',
    }).expect(409);
    expect(
      await prisma.auditLog.count({ where: { action: 'loan.penalty.waive', entityId: loanCode } }),
    ).toBe(1);

    // A payment clears the penalty first, then interest, then principal.
    const paid = await post(staff.officer, `/loans/${loanCode}/payments`, {
      amount: String(284_985 + 5_700),
      channel: 'CASH',
      receivedOn: today,
      idempotencyKey: randomUUID(),
    }).expect(200);
    const payment = await prisma.payment.findFirstOrThrow({
      where: { loanId: loan.id, status: 'SUCCESSFUL' },
      include: { ledgerTransaction: true },
    });
    expect(await entriesFor(payment.ledgerTransaction!.idempotencyKey)).toEqual({
      '1020 DEBIT': 290_685n,
      '1120 CREDIT': 5_700n,
      '4000 CREDIT': 63_750n,
      '1100 CREDIT': 221_235n,
    });
    expect(paid.body.loan.schedule[0].state).toBe('PAID');
    expect(paid.body.loan.penaltiesOwed).toBe('0');
  });

  it('never charge loans signed without a penalty term', async () => {
    await penalties.chargeDue(addDays(today, 400));
    const untermed = await prisma.penaltyCharge.count({ where: { loan: { latePenaltyBps: 0 } } });
    expect(untermed).toBe(0);
  });

  it('keep the penalty receivable equal to what borrowers owe', async () => {
    const [ledger] = await prisma.$queryRaw<Array<{ balance: bigint }>>`
      SELECT COALESCE(SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE -e."amount" END), 0)::bigint AS balance
      FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a."id" = e."accountId"
      WHERE a."code" = '1120'`;
    const [owed] = await prisma.$queryRaw<Array<{ owed: bigint }>>`
      SELECT COALESCE(SUM("penaltyDue" - "penaltyPaid"), 0)::bigint AS owed
      FROM "ScheduleInstalment"`;
    expect(ledger!.balance).toBe(owed!.owed);
  });
});
