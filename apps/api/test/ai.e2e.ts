import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { AiClient, AiUnavailableError, type StructuredRequest } from '../src/ai/ai.client';
import { AiService } from '../src/ai/ai.service';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import { ACCOUNTS } from '../src/ledger/accounts';
import type { PrismaClient } from '../src/generated/prisma/client';
import { runAsCompany } from '../src/tenancy/company-context';
import { testPrisma, byCode, E2E_COMPANY_ID } from './test-db';

/**
 * Phase 5: scoring (against the real rules service) and the Claude features
 * (against a stand-in that records what it was sent and returns set answers).
 */
const PASSWORD = `e2e-${randomUUID()}`;
const PRODUCT = `E2E5-${randomUUID().slice(0, 8)}`;

class FakeAi {
  configured = true;
  model = 'fake-model';
  calls: Array<{ system: string; user: string }> = [];
  queue: unknown[] = [];
  fail = false;
  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    this.calls.push({ system: req.system, user: req.user });
    if (this.fail) throw new AiUnavailableError('The AI service is busy. Try again in a minute.');
    const next = this.queue.shift();
    if (next === undefined) throw new Error('FakeAi: no answer queued');
    return req.schema.parse(next) as z.infer<T>;
  }
}

let app: INestApplication;
let prisma: PrismaClient;
const fake = new FakeAi();
const cookies: Record<'officer' | 'manager', string[]> = { officer: [], manager: [] };
const ids: Record<'officer' | 'manager', string> = { officer: '', manager: '' };

const http = () => request(app.getHttpServer());
const as = (who: 'officer' | 'manager') => ({
  get: (path: string) => http().get(path).set('Cookie', cookies[who]),
  post: (path: string, body: object = {}) =>
    http().post(path).set('Cookie', cookies[who]).send(body),
});
const phone = () => `078${randomInt(1_000_000, 9_999_999)}`;

async function application(
  amount: string,
  opts: { income?: bigint; inflows?: number[]; stated?: bigint } = {},
) {
  const number = phone();
  const res = await as('officer')
    .post('/applications', {
      name: `Score Test ${randomUUID().slice(0, 5)}`,
      phone: number,
      productCode: PRODUCT,
      amount,
      termMonths: 12,
    })
    .expect(201);
  const borrower = await prisma.borrower.findFirstOrThrow({
    where: { code: res.body.borrowerCode },
  });
  if (opts.income != null)
    await prisma.borrower.update({
      where: { id: borrower.id },
      data: { monthlyIncome: opts.income },
    });
  if (opts.stated != null)
    await prisma.application.update({
      where: byCode(res.body.code),
      data: { statedMonthlyIncome: opts.stated },
    });
  if (opts.inflows) {
    await prisma.consent.create({
      data: {
        borrowerId: borrower.id,
        type: 'MOMO_HISTORY',
        textVersion: 'test',
        channel: 'OFFICER',
      },
    });
    await prisma.momoInflowMonth.createMany({
      data: opts.inflows.map((inflow, i) => ({
        borrowerId: borrower.id,
        month: new Date(Date.UTC(2026, i, 1)),
        inflow: BigInt(inflow),
      })),
    });
  }
  return {
    code: res.body.code as string,
    borrowerCode: res.body.borrowerCode as string,
    card: res.body,
  };
}

/** A real loan (approved and disbursed through the API, so the ledger is right), first instalment due on `due`. */
async function liveLoan(borrowerCode: string, appCode: string, due: Date): Promise<string> {
  await as('officer').post(`/applications/${appCode}/move`, { to: 'UNDER_REVIEW' }).expect(200);
  await prisma.application.update({
    where: byCode(appCode),
    data: { statedMonthlyIncome: null },
  });
  await prisma.borrower.update({
    where: byCode(borrowerCode),
    data: { monthlyIncome: 5_000_000n },
  });
  await as('officer')
    .post(`/applications/${appCode}/approve`, { overrideReason: 'test' })
    .expect(200);
  const res = await as('manager')
    .post(`/applications/${appCode}/disburse`, { channel: 'BANK_TRANSFER' })
    .expect(200);
  const loan = await prisma.loan.findFirstOrThrow({ where: { code: res.body.loanCode } });
  await prisma.scheduleInstalment.updateMany({
    where: { loanId: loan.id, number: 1 },
    data: {
      dueDate: new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate())),
    },
  });
  return loan.code;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AiClient)
    .useValue(fake)
    .compile();
  app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  prisma = testPrisma();
  for (const account of Object.values(ACCOUNTS))
    await prisma.ledgerAccount.upsert({
      where: byCode(account.code),
      update: {},
      create: { ...account, companyId: E2E_COMPANY_ID },
    });
  await prisma.product.create({
    data: {
      code: PRODUCT,
      name: 'E2E scored product',
      shortName: 'E2E',
      kind: 'SME',
      annualRateBps: 1700,
      minTermMonths: 3,
      maxTermMonths: 36,
      minAmount: 100_000n,
      maxAmount: 20_000_000n,
      autoApproveMinScore: 700,
      autoApproveMaxAmount: 5_000_000n,
      secondApprovalAbove: 10_000_000n,
    },
  });
  const hash = await hashPassword(PASSWORD);
  for (const [key, role] of [
    ['officer', 'LOAN_OFFICER'],
    ['manager', 'MANAGER'],
  ] as const) {
    const email = `e2e-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
    const user = await prisma.user.create({
      data: { email, passwordHash: hash, firstName: 'E2E', lastName: role, role },
    });
    ids[key] = user.id;
    const res = await http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    cookies[key] = ([] as string[])
      .concat(res.get('Set-Cookie') ?? [])
      .map((c) => c.split(';')[0]!);
  }
});

afterAll(async () => {
  await prisma.product.updateMany({ where: { code: PRODUCT }, data: { isActive: false } });
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-' } },
    data: { isActive: false },
  });
  await app.close();
  await prisma.$disconnect();
});

describe('scoring', () => {
  it('scores a new application and stores the inputs, reasons and model version', async () => {
    const { code, card } = await application('900000');
    expect(card.score).toBeGreaterThanOrEqual(300);
    expect(card.ai).toMatchObject({
      recommendation: 'REVIEW',
      title: 'Review · thin credit file',
      modelVersion: 'rules-v1',
    });
    const stored = await prisma.creditScore.findFirstOrThrow({ where: { application: { code } } });
    expect(stored.inputs).toMatchObject({ history: { instalments_paid: 0 }, momo_inflows: null });
    expect((stored.reasons as Array<{ points: number }>).length).toBeGreaterThan(0);
    // Nothing about who the borrower is goes to the model.
    expect(JSON.stringify(stored.inputs)).not.toMatch(/gender|district|name|phone/i);
  });

  it('uses MoMo history only with consent, and flags an income mismatch', async () => {
    const { code } = await application('1000000', {
      inflows: [500_000, 500_000, 500_000, 500_000, 500_000, 500_000],
    });
    await prisma.application.update({
      where: byCode(code),
      data: { statedMonthlyIncome: 1_500_000n },
    });
    const rescored = await as('officer').post(`/applications/${code}/score`).expect(200);
    expect(rescored.body.ai).toMatchObject({
      recommendation: 'FLAG',
      title: 'Flag · income mismatch',
    });

    // Flagged: approving needs a reason, and the reason is kept against the score.
    await as('officer').post(`/applications/${code}/move`, { to: 'UNDER_REVIEW' }).expect(200);
    const refused = await as('officer').post(`/applications/${code}/approve`).expect(400);
    expect(refused.body.message).toContain('flagged');
    await prisma.borrower.update({
      where: byCode(rescored.body.borrowerCode),
      data: { monthlyIncome: 1_500_000n },
    });
    await as('officer')
      .post(`/applications/${code}/approve`, {
        overrideReason: 'Checked bank statements; second business pays in cash',
      })
      .expect(200);
    const score = await prisma.creditScore.findFirstOrThrow({
      where: { application: { code } },
      orderBy: { createdAt: 'desc' },
    });
    expect(score).toMatchObject({
      overriddenById: ids.officer,
      overrideReason: 'Checked bank statements; second business pays in cash',
    });
  });

  it('records a decline that goes against an approval recommendation', async () => {
    const { code } = await application('600000', {
      income: 3_000_000n,
      inflows: [3_000_000, 3_050_000, 2_950_000, 3_000_000, 3_020_000, 2_980_000],
    });
    const card = (await as('officer').get(`/applications/${code}`).expect(200)).body;
    expect(['APPROVE', 'REVIEW']).toContain(card.ai.recommendation);
    if (card.ai.recommendation !== 'APPROVE') return;
    await as('officer')
      .post(`/applications/${code}/move`, { to: 'DECLINED', reason: 'Business closed last week' })
      .expect(200);
    const score = await prisma.creditScore.findFirstOrThrow({
      where: { application: { code } },
      orderBy: { createdAt: 'desc' },
    });
    expect(score.overrideReason).toBe('Declined: Business closed last week');
  });

  it('"approve low-risk" approves only policy-eligible applications, with a person as decider', async () => {
    // A repeat borrower with a clean record and steady MoMo: auto-approve eligible.
    const first = await application('800000', {
      income: 2_000_000n,
      inflows: [2_000_000, 2_010_000, 1_990_000, 2_000_000, 2_020_000, 1_980_000],
    });
    const borrower = await prisma.borrower.findFirstOrThrow({
      where: { code: first.borrowerCode },
    });
    const product = await prisma.product.findFirstOrThrow({ where: { code: PRODUCT } });
    const old = await prisma.loan.create({
      data: {
        code: `LN-${String(randomInt(1000, 9999))}-1999`,
        borrowerId: borrower.id,
        productId: product.id,
        principal: 500_000n,
        annualRateBps: 1700,
        termMonths: 12,
        instalmentAmount: 45_602n,
        status: 'REPAID',
        firstDueDate: new Date('1999-02-01'),
        maturityDate: new Date('2000-01-01'),
      },
    });
    await prisma.scheduleInstalment.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({
        loanId: old.id,
        number: i + 1,
        dueDate: new Date(Date.UTC(1999, i + 1, 1)),
        principalDue: 40_000n,
        interestDue: 5_602n,
        principalPaid: 40_000n,
        interestPaid: 5_602n,
        status: 'PAID' as const,
        paidAt: new Date(Date.UTC(1999, i + 1, 1)),
      })),
    });
    await prisma.borrower.update({
      where: { id: borrower.id },
      data: { customerSince: new Date('1999-01-01') },
    });
    await prisma.application.update({ where: byCode(first.code), data: { docsReceived: 4 } });
    const card = (await as('officer').post(`/applications/${first.code}/score`).expect(200)).body;
    expect(card.ai.recommendation).toBe('AUTO_APPROVE_ELIGIBLE');
    expect(card.autoEligible).toBe(true);

    const thin = await application('700000');
    const res = await as('officer').post('/applications/auto-approve').expect(200);
    expect(res.body.approved).toContain(first.code);
    expect(res.body.approved).not.toContain(thin.code);
    const row = await prisma.application.findFirstOrThrow({ where: { code: first.code } });
    expect(row).toMatchObject({ stage: 'APPROVED', autoApproved: true, decidedById: ids.officer });
    expect((await prisma.application.findFirstOrThrow({ where: { code: thin.code } })).stage).toBe(
      'NEW',
    );
  });
});

describe('Claude features (with a stand-in model)', () => {
  it('writes a borrower summary from facts only, stores it, and shows it on the profile', async () => {
    const { borrowerCode } = await application('500000', { income: 1_200_000n });
    fake.queue.push({
      summary: 'Steady income, first loan.',
      reasons: [
        { kind: 'why', text: 'Verified income' },
        { kind: 'watch', text: 'No repayment history yet' },
      ],
    });
    const res = await as('officer')
      .post(`/ai/borrowers/${borrowerCode}/summary`, { force: true })
      .expect(200);
    expect(res.body).toMatchObject({
      text: 'Steady income, first loan.',
      modelVersion: 'fake-model',
    });
    const sent = fake.calls.at(-1)!.user;
    const b = await prisma.borrower.findFirstOrThrow({ where: { code: borrowerCode } });
    expect(sent).not.toContain(b.fullName);
    expect(sent).not.toContain(b.phone.slice(4));
    const note = await prisma.aiNote.findFirstOrThrow({
      where: { kind: 'borrower_summary', borrowerId: b.id },
    });
    expect(note).toMatchObject({ model: 'fake-model' });
    expect(note.inputs).toMatchObject({ verifiedMonthlyIncomeRwf: '1200000' });
    const profile = (await as('officer').get(`/borrowers/${borrowerCode}`).expect(200)).body;
    expect(profile.aiSummary.text).toBe('Steady income, first loan.');
    // A second request within a day reuses the stored summary.
    const before = fake.calls.length;
    await as('officer').post(`/ai/borrowers/${borrowerCode}/summary`, {}).expect(200);
    expect(fake.calls.length).toBe(before);
  });

  it('says so plainly when the model is unavailable', async () => {
    const { borrowerCode } = await application('500000');
    fake.fail = true;
    const res = await as('officer')
      .post(`/ai/borrowers/${borrowerCode}/summary`, { force: true })
      .expect(503);
    expect(res.body.message).toContain('busy');
    fake.fail = false;
  });

  it('suggests a collections approach with a Kinyarwanda draft', async () => {
    const { borrowerCode, code } = await application('500000');
    const loanCode = await liveLoan(borrowerCode, code, new Date(Date.now() - 20 * 86_400_000));
    const loan = await prisma.loan.findFirstOrThrow({ where: { code: loanCode } });
    fake.queue.push({
      bestTime: 'Weekday mornings',
      offer: 'Two smaller payments',
      assessment: 'Likely to pay after a call',
      smsKinyarwanda: 'Muraho, ni Kora Lend.',
    });
    const res = await as('officer').get(`/ai/collections/${loan.code}/approach`).expect(200);
    expect(res.body.approach).toMatchObject({
      bestTime: 'Weekday mornings',
      smsKinyarwanda: 'Muraho, ni Kora Lend.',
      model: 'fake-model',
    });
    const note = await prisma.aiNote.findFirstOrThrow({
      where: { kind: 'collections_approach', loanId: loan.id },
    });
    // The greeting name is used for the draft but not kept with the stored inputs.
    expect(JSON.stringify(note.inputs)).not.toContain('greetingName');
    expect(fake.calls.at(-1)!.system).toContain('Never suggest threats');
  });

  it('answers a data question with read-only SQL, and shows the query', async () => {
    if (!process.env.REPORTING_DATABASE_URL) return;
    fake.queue.push({
      sql: 'SELECT product, COUNT(*)::int AS loans FROM loans GROUP BY product ORDER BY 2 DESC',
      title: 'Loans by product',
    });
    fake.queue.push({
      headline: 'Most loans are SME',
      body: 'Counted from the loans view.',
      bars: [{ label: 'SME', value: 3 }],
      unit: 'loans',
    });
    const res = await as('manager')
      .post('/ai/ask', { question: 'How many loans do we have per product?' })
      .expect(200);
    expect(res.body).toMatchObject({
      ok: true,
      headline: 'Most loans are SME',
      sql: expect.stringContaining('FROM loans'),
    });
    expect(res.body.rowCount).toBeGreaterThan(0);
    // The rows sent back to the model come from the reporting views only.
    expect(fake.calls.at(-1)!.user).not.toMatch(/\+2507\d{8}/);
    const saved = await prisma.dataQuestion.findFirstOrThrow({
      where: { userId: ids.manager },
      orderBy: { createdAt: 'desc' },
    });
    expect(saved.sql).toContain('FROM loans');
    await as('officer')
      .post('/ai/ask', { question: 'How many loans do we have per product?' })
      .expect(403);
  });

  it('refuses model-written SQL that writes or reaches past the views, even after a retry', async () => {
    if (!process.env.REPORTING_DATABASE_URL) return;
    fake.queue.push({ sql: 'DELETE FROM loans', title: 'x' });
    fake.queue.push({ sql: 'SELECT * FROM public."User"', title: 'x' });
    const res = await as('manager')
      .post('/ai/ask', { question: 'Delete every loan please' })
      .expect(200);
    expect(res.body.ok).toBe(false);
    expect(await prisma.loan.count()).toBeGreaterThan(0);
    const saved = await prisma.dataQuestion.findFirstOrThrow({
      where: { userId: ids.manager },
      orderBy: { createdAt: 'desc' },
    });
    expect(saved.error).toBeTruthy();
  });

  it('even a query that slips past the check cannot write, thanks to the read-only login', async () => {
    if (!process.env.REPORTING_DATABASE_URL) return;
    const service = app.get(AiService);
    const run = (sql: string) => runAsCompany(E2E_COMPANY_ID, () => service.run(sql));
    await expect(run('SELECT * FROM "Borrower"')).rejects.toThrow(
      /does not exist|permission denied/,
    );
    await expect(
      run('SELECT 1 FROM loans WHERE false UNION SELECT count(*) FROM pg_catalog.pg_authid'),
    ).rejects.toThrow();
  });

  it('reports scores by gender and district for managers', async () => {
    const rows = (await as('manager').get('/ai/fairness').expect(200)).body as Array<{
      dimension: string;
    }>;
    expect(rows.some((r) => r.dimension === 'gender')).toBe(true);
    await as('officer').get('/ai/fairness').expect(403);
  });
});

describe('early warning', () => {
  it('flags an up-to-date borrower whose MoMo inflows just fell', async () => {
    const { borrowerCode, code } = await application('500000', {
      inflows: [1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 400_000],
    });
    await liveLoan(borrowerCode, code, new Date(Date.now() + 10 * 86_400_000));
    await prisma.aiNote.deleteMany({ where: { kind: 'early_warning' } });
    const res = (await as('officer').get('/ai/early-warning').expect(200)).body;
    expect(res.available).toBe(true);
    const mine = res.flagged.find((f: { name: string }) => f.name.startsWith('Score'));
    expect(mine.signals[0]).toMatch(/MoMo inflows down \d+% this month/);
    const sent = (await as('officer').post('/ai/early-warning/check-ins').expect(200)).body.sent;
    expect(sent).toBeGreaterThanOrEqual(1);
    expect((await as('officer').post('/ai/early-warning/check-ins').expect(200)).body.sent).toBe(0);
  });
});
