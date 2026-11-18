import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { addMonths, calcInstalment, kigaliDate, legacyTerms } from '@kora/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGREEMENT_VERSION } from '../src/agreements/template';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import { ACCOUNTS } from '../src/ledger/accounts';
import { MomoSimulator } from '../src/providers/momo.simulator';
import type { PrismaClient } from '../src/generated/prisma/client';
import { CompaniesService } from '../src/tenancy/companies.service';
import { signInWithSms, smsTwoFactor } from './sign-in';
import { testPrisma, byCode, E2E_COMPANY_ID } from './test-db';

/** Phase 3: the borrower app's API, from OTP sign-in to a submitted application. */
const PASSWORD = `e2e-${randomUUID()}`;
const PRODUCT = `E2E3-${randomUUID().slice(0, 8)}`;
const today = kigaliDate();

let app: INestApplication;
let prisma: PrismaClient;
let staffCookies: string[] = [];
let managerCookies: string[] = [];

const http = () => request(app.getHttpServer());
const phone = () => `078${randomInt(1_000_000, 9_999_999)}`;
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Sign a borrower in through the real OTP flow, reading the code from the simulated SMS. */
async function signInBorrower(number: string): Promise<string> {
  await http().post('/app/auth/request-code').send({ phone: number }).expect(200);
  const challenge = await prisma.otpChallenge.findFirstOrThrow({
    where: { phone: `+250${number.slice(1)}` },
    orderBy: { createdAt: 'desc' },
  });
  // The code itself is never stored; find it by matching the hash, as a test-only shortcut.
  const { createHash } = await import('node:crypto');
  let code = '';
  for (let i = 0; i < 1_000_000; i++) {
    const c = String(i).padStart(6, '0');
    if (
      createHash('sha256')
        .update(`+250${number.slice(1)}:${c}`)
        .digest('base64url') === challenge.codeHash
    ) {
      code = c;
      break;
    }
  }
  const res = await http().post('/app/auth/verify').send({ phone: number, code }).expect(200);
  return res.body.accessToken as string;
}

async function borrowerWithLoan(
  number: string,
  amount = '1200000',
): Promise<{ loanCode: string; borrowerCode: string }> {
  const created = await http()
    .post('/applications')
    .set('Cookie', staffCookies)
    .send({
      name: `App User ${randomUUID().slice(0, 5)}`,
      phone: number,
      productCode: PRODUCT,
      amount,
      termMonths: 12,
    })
    .expect(201);
  await prisma.borrower.update({
    where: byCode(created.body.borrowerCode),
    data: { momoLinked: true, monthlyIncome: 2_000_000n, preApprovedLimit: 3_000_000n },
  });
  await http()
    .post(`/applications/${created.body.code}/move`)
    .set('Cookie', staffCookies)
    .send({ to: 'UNDER_REVIEW' })
    .expect(200);
  await http()
    .post(`/applications/${created.body.code}/approve`)
    .set('Cookie', staffCookies)
    .expect(200);
  await http()
    .post(`/applications/${created.body.code}/agreement`)
    .set('Cookie', staffCookies)
    .expect(200);
  const res = await http()
    .post(`/applications/${created.body.code}/disburse`)
    .set('Cookie', managerCookies)
    .send({ channel: 'BANK_TRANSFER' })
    .expect(200);
  return { loanCode: res.body.loanCode, borrowerCode: created.body.borrowerCode };
}

beforeAll(async () => {
  MomoSimulator.settleAfterMs = 0;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  prisma = testPrisma();
  // These tests cover the SMS OTP path; the company flag defaults to off.
  await prisma.company.update({
    where: { id: E2E_COMPANY_ID },
    data: { borrowerOtp: true },
  });
  app.get(CompaniesService).invalidate();
  for (const account of Object.values(ACCOUNTS))
    await prisma.ledgerAccount.upsert({
      where: byCode(account.code),
      update: {},
      create: { ...account, companyId: E2E_COMPANY_ID },
    });
  await prisma.product.create({
    data: {
      code: PRODUCT,
      name: 'E2E app product',
      shortName: 'E2E',
      kind: 'SME',
      terms: legacyTerms(1700) as object,
      annualRateBps: 1700,
      minTermMonths: 6,
      maxTermMonths: 24,
      minAmount: 500_000n,
      maxAmount: 6_000_000n,
    },
  });
  const hash = await hashPassword(PASSWORD);
  for (const [role, store] of [
    ['LOAN_OFFICER', 'staff'],
    ['MANAGER', 'manager'],
  ] as const) {
    const email = `e2e-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
    const factor = smsTwoFactor();
    await prisma.user.create({
      data: { email, passwordHash: hash, firstName: 'E2E', lastName: role, role, ...factor },
    });
    const res = await signInWithSms(app, { email, phone: factor.phone }, PASSWORD);
    const cookies = ([] as string[])
      .concat(res.get('Set-Cookie') ?? [])
      .map((c) => c.split(';')[0]!);
    if (store === 'staff') staffCookies = cookies;
    else managerCookies = cookies;
  }
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

describe('sign-in by phone', () => {
  it('answers the same for known and new numbers', async () => {
    const number = phone();
    const unknown = await http().post('/app/auth/request-code').send({ phone: number }).expect(200);
    expect(unknown.body.otpRequired).toBe(true);
    expect(unknown.body.sent).toBe(true);
    expect(unknown.body.phone).toMatch(/^\+250 78• ••• \d{3}$/);
    // A new number gets a code to sign up with (see register.e2e.ts).
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { phone: `+250${number.slice(1)}` },
    });
    expect(challenge.signup).toBe(true);
    await http().post('/app/auth/request-code').send({ phone: '12345' }).expect(400);
  });

  it('signs in with the phone alone when borrower OTP is off', async () => {
    await prisma.company.update({
      where: { id: E2E_COMPANY_ID },
      data: { borrowerOtp: false },
    });
    app.get(CompaniesService).invalidate();
    const number = phone();
    await borrowerWithLoan(number);
    const res = await http().post('/app/auth/request-code').send({ phone: number }).expect(200);
    expect(res.body.otpRequired).toBe(false);
    expect(res.body.accessToken).toBeTruthy();
    await http().get('/app/home').set(bearer(res.body.accessToken)).expect(200);
    // A new number still gets a code, to sign up with.
    const fresh = await http().post('/app/auth/request-code').send({ phone: phone() }).expect(200);
    expect(fresh.body.otpRequired).toBe(true);
    // Put OTP back on for the remaining tests.
    await prisma.company.update({
      where: { id: E2E_COMPANY_ID },
      data: { borrowerOtp: true },
    });
    app.get(CompaniesService).invalidate();
  });

  it('signs in with the texted code, and the code works once', async () => {
    const number = phone();
    await borrowerWithLoan(number);
    const token = await signInBorrower(number);
    const home = await http().get('/app/home').set(bearer(token)).expect(200);
    expect(home.body.loan.code).toMatch(/^LN-/);
    const sms = await prisma.smsMessage.findFirst({
      where: { template: 'otp' },
      orderBy: { createdAt: 'desc' },
    });
    expect(sms?.body).toContain('••••••');
    expect(sms?.body).not.toMatch(/code is \d{6}/);
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { phone: `+250${number.slice(1)}` },
      orderBy: { createdAt: 'desc' },
    });
    expect(challenge.consumedAt).not.toBeNull();
  });

  it('rejects wrong codes, burns the code after five tries, and limits requests', async () => {
    const number = phone();
    await borrowerWithLoan(number);
    await http().post('/app/auth/request-code').send({ phone: number }).expect(200);
    for (let i = 0; i < 5; i++)
      await http().post('/app/auth/verify').send({ phone: number, code: '000000' }).expect(401);
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { phone: `+250${number.slice(1)}` },
      orderBy: { createdAt: 'desc' },
    });
    expect(challenge.attempts).toBe(5);
    for (let i = 0; i < 4; i++)
      await http().post('/app/auth/request-code').send({ phone: number }).expect(200);
    await http().post('/app/auth/request-code').send({ phone: number }).expect(429);
    await http().get('/app/home').expect(401);
    await http().get('/app/home').set(bearer('not-a-token')).expect(401);
  });

  it('refreshes and signs out', async () => {
    const number = phone();
    await borrowerWithLoan(number);
    await http().post('/app/auth/request-code').send({ phone: number }).expect(200);
    const token = await signInBorrower(number);
    const session = await prisma.borrowerSession.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });
    expect(session.refreshTokenHash).not.toContain(token);
    await http().post('/app/auth/logout').set(bearer(token)).expect(204);
    await http().get('/app/home').set(bearer(token)).expect(401);
  });
});

describe('home and payments', () => {
  it('shows the current loan and pays the next instalment with MoMo', async () => {
    const number = phone();
    const { loanCode } = await borrowerWithLoan(number);
    const token = await signInBorrower(number);
    const home = (await http().get('/app/home').set(bearer(token)).expect(200)).body;
    const instalment = calcInstalment(1_200_000n, 1700, 12);
    expect(home.loan).toMatchObject({
      code: loanCode,
      instalmentCount: 12,
      paidCount: 0,
      repaidPercent: 0,
    });
    expect(home.loan.next).toMatchObject({
      number: 1,
      dueDate: addMonths(today, 1),
      amount: instalment.toString(),
      state: 'DUE_NEXT',
    });
    expect(home.wallet).toMatch(/^MTN MoMo · 078• ••• \d{3}$/);
    expect(JSON.stringify(home)).not.toContain(number.slice(1));

    const pay = await http()
      .post(`/app/loans/${loanCode}/pay`)
      .set(bearer(token))
      .send({})
      .expect(202);
    expect(pay.body.status).toBe('PENDING');
    const status = await http()
      .get(`/app/payments/${pay.body.paymentId}`)
      .set(bearer(token))
      .expect(200);
    expect(status.body.status).toBe('SUCCESSFUL');
    const after = (await http().get('/app/home').set(bearer(token)).expect(200)).body;
    expect(after.loan.paidCount).toBe(1);
    expect(after.loan.activity[0]).toMatchObject({
      title: 'Instalment 1 paid early',
      amount: instalment.toString(),
    });
    const schedule = (
      await http().get(`/app/loans/${loanCode}/schedule`).set(bearer(token)).expect(200)
    ).body;
    expect(schedule.rows[0].state).toBe('PAID');
    expect(schedule.rows).toHaveLength(12);
  });

  it('can pay from another MTN number, whose owner approves the prompt', async () => {
    const number = phone();
    const { loanCode } = await borrowerWithLoan(number);
    const token = await signInBorrower(number);
    const pay = (phoneNumber: string) =>
      http().post(`/app/loans/${loanCode}/pay`).set(bearer(token)).send({ phone: phoneNumber });

    const bad = await pay('0758 123 412').expect(400);
    expect(bad.body.message).toBe('Enter a Rwandan mobile number, like 078 123 4567');
    const airtel = await pay('0722 550 118').expect(400);
    expect(airtel.body.message).toBe('MoMo payments need an MTN number starting 078 or 079');
    expect(await prisma.payment.count({ where: { loan: { code: loanCode } } })).toBe(0);

    // The MoMo simulator declines numbers ending 00, so avoid them.
    const other = `079${randomInt(100_000, 999_999)}7`;
    const res = await pay(other).expect(202);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: res.body.paymentId } });
    expect(payment.payerPhone).toBe(`+250${other.slice(1)}`);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'loan.payment.request', entityId: loanCode },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.metadata).toMatchObject({ otherPayer: true });
    // The number never appears in full in the audit trail.
    expect(JSON.stringify(audit.metadata)).not.toContain(other.slice(1));
    const status = await http()
      .get(`/app/payments/${res.body.paymentId}`)
      .set(bearer(token))
      .expect(200);
    expect(status.body.status).toBe('SUCCESSFUL');
  });

  it('shows the statement, insights and who to contact', async () => {
    const number = phone();
    const { loanCode } = await borrowerWithLoan(number);
    const token = await signInBorrower(number);
    const pay = await http()
      .post(`/app/loans/${loanCode}/pay`)
      .set(bearer(token))
      .send({})
      .expect(202);
    await http().get(`/app/payments/${pay.body.paymentId}`).set(bearer(token)).expect(200);

    const statement = (
      await http().get(`/app/loans/${loanCode}/statement`).set(bearer(token)).expect(200)
    ).body;
    expect(statement.payments).toHaveLength(1);
    expect(statement.payments[0]).toMatchObject({ channel: 'MTN MoMo', note: 'Instalment 1' });
    expect(BigInt(statement.totalPaid) + BigInt(statement.leftToPay)).toBeGreaterThan(1_200_000n);

    const insights = (await http().get('/app/insights').set(bearer(token)).expect(200)).body;
    expect(insights).toMatchObject({
      instalmentsPaid: 1,
      paidOnTime: 1,
      paidEarly: 1,
      onTimeRatePct: 100,
      overdueNow: 0,
    });
    expect(insights.months).toHaveLength(6);
    expect(insights.months[5].amount).toBe(statement.payments[0].amount);

    const home = (await http().get('/app/home').set(bearer(token)).expect(200)).body;
    expect(home.support).toHaveProperty('officerName');
  });

  it('cannot see or pay another borrower’s loan', async () => {
    const mine = phone();
    const theirs = phone();
    await borrowerWithLoan(mine);
    const other = await borrowerWithLoan(theirs);
    const token = await signInBorrower(mine);
    await http().get(`/app/loans/${other.loanCode}/schedule`).set(bearer(token)).expect(404);
    await http().post(`/app/loans/${other.loanCode}/pay`).set(bearer(token)).send({}).expect(404);
    await http().get(`/app/loans/${other.loanCode}/statement`).set(bearer(token)).expect(404);
  });
});

describe('applying in the app', () => {
  it('quotes, uploads photos, records consent and creates the application', async () => {
    const nationalId = `11990800${randomInt(10_000_000, 99_999_999)}`;
    const number = phone();
    const { borrowerCode } = await borrowerWithLoan(number);
    const token = await signInBorrower(number);

    const options = (await http().get('/app/apply/options').set(bearer(token)).expect(200)).body;
    expect(options.preApprovedLimit).toBe('3000000');
    expect(options.purposes).toContain('Equipment');
    const product = options.products.find((p: { code: string }) => p.code === PRODUCT);
    expect(product.terms).toEqual([6, 9, 12, 18, 24]);

    const quote = (
      await http()
        .get(`/app/apply/quote?productCode=${PRODUCT}&amount=2500000&termMonths=12`)
        .set(bearer(token))
        .expect(200)
    ).body;
    expect(quote.monthly).toBe(calcInstalment(2_500_000n, 1700, 12).toString());
    expect(quote.firstPayment).toBe(addMonths(today, 1));
    expect(quote.affordability.affordable).toBe(true);

    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64),
    ]);
    const idUpload = await http()
      .post('/app/apply/upload/id')
      .set(bearer(token))
      .attach('file', png, { filename: 'id.png', contentType: 'image/png' })
      .expect(201);
    expect(idUpload.body.key).toMatch(/^kyc\/.+\/id-.+\.png$/);
    await http()
      .post('/app/apply/upload/selfie')
      .set(bearer(token))
      .attach('file', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' })
      .expect(400);
    await http()
      .post('/app/apply/upload/selfie')
      .set(bearer(token))
      .attach('file', png, { filename: 'x.exe', contentType: 'application/octet-stream' })
      .expect(400);

    await http()
      .post('/app/apply')
      .set(bearer(token))
      .send({
        productCode: PRODUCT,
        amount: '2500000',
        termMonths: 12,
        purpose: 'Equipment',
        agreedTerms: false,
      })
      .expect(400);
    const res = await http()
      .post('/app/apply')
      .set(bearer(token))
      .send({
        productCode: PRODUCT,
        amount: '2500000',
        termMonths: 12,
        purpose: 'Equipment',
        businessName: 'Test Tailoring',
        businessSector: 'Garments & tailoring',
        monthlyRevenue: '1650000',
        nationalId,
        shareMomoHistory: true,
        agreedTerms: true,
        agreementVersion: AGREEMENT_VERSION,
        agreedBureau: true,
        idPhotoKey: idUpload.body.key,
      })
      .expect(201);
    expect(res.body.code).toMatch(/^APP-\d+$/);

    const application = await prisma.application.findFirstOrThrow({
      where: { code: res.body.code },
      include: { consents: true, borrower: true },
    });
    expect(application).toMatchObject({
      channel: 'APP',
      stage: 'NEW',
      purpose: 'Equipment',
      businessName: 'Test Tailoring',
      statedMonthlyIncome: 1_650_000n,
    });
    expect(application.consents.map((c) => c.type).sort()).toEqual([
      'CREDIT_BUREAU',
      'DATA_PROCESSING',
      'MOMO_HISTORY',
      'TERMS',
    ]);
    // The ID number is encrypted, and only its last three digits are readable.
    expect(application.borrower.nationalIdEnc).not.toContain(nationalId);
    expect(application.borrower.nationalIdLast3).toBe(nationalId.slice(-3));
    expect(
      await prisma.kycDocument.count({
        where: {
          borrowerId: application.borrowerId,
          type: 'NATIONAL_ID',
          storageKey: idUpload.body.key,
        },
      }),
    ).toBe(1);

    // It shows up for the officer like any other application, and only one can be open.
    const card = (
      await http().get(`/applications/${res.body.code}`).set('Cookie', staffCookies).expect(200)
    ).body;
    expect(card.borrowerCode).toBe(borrowerCode);
    await http()
      .post('/app/apply')
      .set(bearer(token))
      .send({
        productCode: PRODUCT,
        amount: '600000',
        termMonths: 6,
        purpose: 'Stock',
        agreedTerms: true,
        agreementVersion: AGREEMENT_VERSION,
      })
      .expect(409);
    const home = (await http().get('/app/home').set(bearer(token)).expect(200)).body;
    expect(home.application.code).toBe(res.body.code);
  });

  it('refuses an ID number that belongs to another customer, with a clear message', async () => {
    const nationalId = `11990800${randomInt(10_000_000, 99_999_999)}`;
    const first = phone();
    const second = phone();
    await borrowerWithLoan(first);
    await borrowerWithLoan(second);
    const body = {
      productCode: PRODUCT,
      amount: '600000',
      termMonths: 6,
      purpose: 'Stock',
      agreedTerms: true,
      agreementVersion: AGREEMENT_VERSION,
      nationalId,
    };
    await http()
      .post('/app/apply')
      .set(bearer(await signInBorrower(first)))
      .send(body)
      .expect(201);
    const res = await http()
      .post('/app/apply')
      .set(bearer(await signInBorrower(second)))
      .send(body)
      .expect(409);
    expect(res.body.message).toContain('already registered');
  });

  it('a staff offer shows on the home screen and is taken by applying', async () => {
    const number = phone();
    const { borrowerCode } = await borrowerWithLoan(number);
    const offer = await http()
      .post(`/borrowers/${borrowerCode}/offers`)
      .set('Cookie', staffCookies)
      .expect(201);
    expect(offer.body.maxAmount).toBe('3000000');
    await http().post(`/borrowers/${borrowerCode}/offers`).set('Cookie', staffCookies).expect(400);
    const token = await signInBorrower(number);
    const home = (await http().get('/app/home').set(bearer(token)).expect(200)).body;
    expect(home.offer).toMatchObject({ maxAmount: '3000000', productCode: PRODUCT });
    const notes = (await http().get('/app/notifications').set(bearer(token)).expect(200)).body;
    expect(notes[0].title).toContain('pre-approved');
    expect(home.unread).toBeGreaterThanOrEqual(1);
    expect((await http().get('/app/home').set(bearer(token)).expect(200)).body.unread).toBe(0);
  });

  it('profile masks personal data and lets consent be withdrawn', async () => {
    const number = phone();
    await borrowerWithLoan(number);
    const token = await signInBorrower(number);
    const profile = (await http().get('/app/profile').set(bearer(token)).expect(200)).body;
    expect(profile.phone).toMatch(/^\+250 78• ••• \d{3}$/);
    await http()
      .post('/app/profile/consents/withdraw')
      .set(bearer(token))
      .send({ type: 'MOMO_HISTORY' })
      .expect(204);
    await http()
      .post('/app/profile/consents/withdraw')
      .set(bearer(token))
      .send({ type: 'TERMS' })
      .expect(400);
  });
});

describe('Kinyarwanda for borrowers', () => {
  it('saves the borrower’s language and uses it on screens and in every SMS', async () => {
    const number = phone();
    const { loanCode, borrowerCode } = await borrowerWithLoan(number);
    const token = await signInBorrower(number);
    expect((await http().get('/app/home').set(bearer(token)).expect(200)).body.language).toBe('EN');

    await http()
      .post('/app/profile/language')
      .set(bearer(token))
      .send({ language: 'FR' })
      .expect(400);
    const saved = await http()
      .post('/app/profile/language')
      .set(bearer(token))
      .send({ language: 'RW' })
      .expect(200);
    expect(saved.body).toEqual({ language: 'RW' });
    const borrower = await prisma.borrower.findFirstOrThrow({
      where: { companyId: E2E_COMPANY_ID, code: borrowerCode },
    });
    expect(borrower.preferredLanguage).toBe('RW');
    expect(
      await prisma.auditLog.count({
        where: { action: 'borrower.language.change', entityId: borrower.id },
      }),
    ).toBe(1);
    expect((await http().get('/app/profile').set(bearer(token)).expect(200)).body.language).toBe(
      'RW',
    );

    const pay = await http()
      .post(`/app/loans/${loanCode}/pay`)
      .set(bearer(token))
      .send({})
      .expect(202);
    await http().get(`/app/payments/${pay.body.paymentId}`).set(bearer(token)).expect(200);
    const home = (await http().get('/app/home').set(bearer(token)).expect(200)).body;
    expect(home.language).toBe('RW');
    expect(home.loan.activity[0].title).toBe('Igice cya 1 cyishyuwe mbere y’igihe');

    const receipt = await prisma.smsMessage.findFirstOrThrow({
      where: { borrowerId: borrower.id, template: 'payment.received' },
      orderBy: { createdAt: 'desc' },
    });
    expect(receipt.language).toBe('RW');
    expect(receipt.body).toMatch(/twakiriye RWF [\d,]+ ku nguzanyo LN-\d{4}-\d{4}\. Murakoze\./);
    const notices = (await http().get('/app/notifications').set(bearer(token)).expect(200)).body;
    expect(notices[0].title).toMatch(/^Twakiriye RWF [\d,]+ ku nguzanyo /);

    // The sign-in code also arrives in Kinyarwanda, and the stored copy hides it.
    await http().post('/app/auth/request-code').send({ phone: number }).expect(200);
    const otp = await prisma.smsMessage.findFirstOrThrow({
      where: { borrowerId: borrower.id, template: 'otp' },
      orderBy: { createdAt: 'desc' },
    });
    expect(otp.language).toBe('RW');
    expect(otp.body).toMatch(/kode yawe yo kwinjira ni ••••••\./);
  });

  it('gives staff the house reminder in both languages', async () => {
    const number = phone();
    const { loanCode } = await borrowerWithLoan(number);
    const drafts = (
      await http()
        .get(`/collections/accounts/${loanCode}/drafts`)
        .set('Cookie', managerCookies)
        .expect(200)
    ).body;
    expect(drafts.english).toMatch(/^Hello App, this is .+ A reminder that/);
    expect(drafts.kinyarwanda).toMatch(/^Muraho App, ni .+ Turabibutsa ko/);
    expect(drafts.preferred).toBe('EN');
  });
});
