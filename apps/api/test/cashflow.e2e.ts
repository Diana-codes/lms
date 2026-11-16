import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { legacyTerms } from '@kora/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { AiClient, type StructuredRequest } from '../src/ai/ai.client';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import type { PrismaClient, StaffRole } from '../src/generated/prisma/client';
import { signInWithSms, smsTwoFactor } from './sign-in';
import { E2E_COMPANY_ID, testPrisma } from './test-db';

/** PRD §6.15: AI cash-flow analysis, advisory, reviewed by a credit analyst. */
const PASSWORD = `e2e-${randomUUID()}`;
const PRODUCT = `E2C-${randomUUID().slice(0, 8)}`;
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
// Unique per run: the test database is kept, and identical files are flagged as reused.
const RUN = randomUUID().slice(0, 8);

/** Stands in for Claude reading PDFs: answers from a queue, records what it saw. */
class FakeAi {
  configured = true;
  model = 'fake-reader';
  seenFiles: string[] = [];
  queue: unknown[] = [];
  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    if (req.file) this.seenFiles.push(req.file.mediaType);
    const next = this.queue.shift();
    if (next === undefined) throw new Error('FakeAi: no answer queued');
    return req.schema.parse(next) as z.infer<T>;
  }
}

let app: INestApplication;
let prisma: PrismaClient;
const fake = new FakeAi();
type Agent = { cookies: string[]; id: string };
const staff = {} as Record<'officer' | 'analyst' | 'auditor' | 'collections', Agent>;

const http = () => request(app.getHttpServer());
const get = (who: Agent, path: string) => http().get(path).set('Cookie', who.cookies);
const post = (who: Agent, path: string, body: object = {}) =>
  http().post(path).set('Cookie', who.cookies).set('Origin', ORIGIN).send(body);
const patch = (who: Agent, path: string, body: object = {}) =>
  http().patch(path).set('Cookie', who.cookies).set('Origin', ORIGIN).send(body);
const upload = (who: Agent, code: string, kind: string, name: string, content: Buffer | string) =>
  http()
    .post(`/applications/${code}/cashflow/documents`)
    .set('Cookie', who.cookies)
    .set('Origin', ORIGIN)
    .field('kind', kind)
    .attach('file', Buffer.from(content), name);

async function signIn(role: StaffRole, passwordHash: string): Promise<Agent> {
  const email = `e2e-cf-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
  const factor = smsTwoFactor();
  const user = await prisma.user.create({
    data: { email, passwordHash, firstName: 'E2E', lastName: role, role, ...factor },
  });
  const res = await signInWithSms(app, { email, phone: factor.phone }, PASSWORD);
  const cookies = ([] as string[]).concat(res.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]!);
  return { cookies, id: user.id };
}

async function newApplication(name: string) {
  const res = await post(staff.officer, '/applications', {
    name,
    phone: `078${randomInt(1_000_000, 9_999_999)}`,
    productCode: PRODUCT,
    amount: '1000000',
    termMonths: 12,
  }).expect(201);
  return res.body.code as string;
}

/** A MoMo export: six months of sales, rent and a MoKash repayment, with balances. */
function momoCsv(): string {
  const lines = [`Id,Date,Description,Money In,Money Out,Balance,Ref ${RUN}`];
  let balance = 100_000;
  let id = 1;
  for (const m of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']) {
    const rows: Array<[string, string, number, number]> = [
      [`${m}-03`, 'MoMo Pay merchant payment received', 300_000, 0],
      [`${m}-05`, 'Rent to landlord', 0, 80_000],
      [`${m}-12`, 'MoMo Pay merchant payment received', 250_000, 0],
      [`${m}-20`, 'MoKash loan repayment', 0, 50_000],
      [`${m}-25`, 'Received from +250788000001', 40_000, 0],
    ];
    for (const [d, desc, inn, out] of rows) {
      balance += inn - out;
      lines.push(
        `${id++},${d.split('-').reverse().join('/')},${desc},${inn || ''},${out || ''},${balance}`,
      );
    }
  }
  return lines.join('\r\n') + '\r\n';
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
  await prisma.product.create({
    data: {
      code: PRODUCT,
      name: 'E2E cash-flow product',
      shortName: 'CF',
      kind: 'SME',
      terms: legacyTerms(2400) as object,
      annualRateBps: 2400,
      minTermMonths: 3,
      maxTermMonths: 24,
      minAmount: 100_000n,
      maxAmount: 10_000_000n,
      affordabilityBps: 3500,
    },
  });
  const hash = await hashPassword(PASSWORD);
  staff.officer = await signIn('LOAN_OFFICER', hash);
  staff.analyst = await signIn('CREDIT_ANALYST', hash);
  staff.auditor = await signIn('AUDITOR', hash);
  staff.collections = await signIn('COLLECTIONS_AGENT', hash);
});

afterAll(async () => {
  await prisma.product.updateMany({ where: { code: PRODUCT }, data: { status: 'RETIRED' } });
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-cf-' } },
    data: { isActive: false },
  });
  await app.close();
  await prisma.$disconnect();
});

describe('cash-flow analysis', () => {
  let code = '';
  let analysisId = '';

  it('needs documents and the borrower’s consent before it runs', async () => {
    code = await newApplication('Aline Uwase');
    await post(staff.analyst, `/applications/${code}/cashflow/analyse`).expect(409);
    await upload(staff.analyst, code, 'MOMO_STATEMENT', 'momo.csv', momoCsv()).expect(201);
    const refused = await post(staff.analyst, `/applications/${code}/cashflow/analyse`).expect(409);
    expect(refused.body.message).toMatch(/consent/);
    await post(staff.analyst, `/applications/${code}/cashflow/consent`).expect(201);
    // Collections agents do not work applications.
    await post(staff.collections, `/applications/${code}/cashflow/analyse`).expect(403);
  });

  it('reads a MoMo CSV and reports income, commitments and an affordable range', async () => {
    const res = await post(staff.analyst, `/applications/${code}/cashflow/analyse`).expect(200);
    const a = res.body.analysis;
    expect(a.status).toBe('READY_FOR_REVIEW');
    expect(a.modelVersion).toBe('cashflow-rules-v1');
    expect(res.body.documents[0]).toMatchObject({ status: 'READ', extractor: 'csv-v1' });
    expect(a.transactions).toHaveLength(30);
    expect(a.report.averageIncome).toMatchObject({ value: '590000', confidence: 'HIGH' });
    expect(a.report.existingDebtRepayments.value).toBe('50000');
    expect(a.report.recurringCommitments.value).toBe('80000');
    // 35% of 590,000 = 206,500, less 50,000 already going to another lender.
    expect(a.report.affordable).toMatchObject({ high: '156500', dsrBps: 3500 });
    expect(a.report.averageIncome.sources).toHaveLength(18);
    expect(a.flags.map((f: { code: string }) => f.code)).toEqual(['OTHER_LENDERS']);
    analysisId = a.id;
    // Auditors can look; nobody outside staff sees it (there is no borrower route).
    await get(staff.auditor, `/applications/${code}/cashflow`).expect(200);
  });

  it('analysts can correct a category, and the figures follow', async () => {
    const view = await get(staff.analyst, `/applications/${code}/cashflow`).expect(200);
    const transfers = view.body.analysis.transactions.filter(
      (t: { category: string }) => t.category === 'TRANSFER_IN',
    );
    expect(transfers).toHaveLength(6);
    await patch(staff.analyst, `/cashflow/transactions/${transfers[0].id}`, {
      category: 'LOAN_RECEIVED',
      reason: 'Borrowed from a cousin',
    }).expect(200);
    const after = await get(staff.analyst, `/applications/${code}/cashflow`).expect(200);
    const fixed = after.body.analysis.transactions.find(
      (t: { id: string }) => t.id === transfers[0].id,
    );
    expect(fixed).toMatchObject({
      category: 'LOAN_RECEIVED',
      suggestedCategory: 'TRANSFER_IN',
      corrected: true,
    });
    // May (a partial month) is outside the averaging window, so only later months move.
    expect(after.body.analysis.report.incomeBySource.length).toBeGreaterThan(0);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'cashflow.transaction.correct', entityId: code },
    });
    expect(audit?.metadata).toMatchObject({ from: 'TRANSFER_IN', to: 'LOAN_RECEIVED' });
  });

  it('the analyst confirms income only after every flag has an outcome', async () => {
    const blocked = await post(staff.analyst, `/cashflow/analyses/${analysisId}/review`, {
      confirmedIncome: '580000',
    }).expect(409);
    expect(blocked.body.message).toMatch(/flag/);
    const view = await get(staff.analyst, `/applications/${code}/cashflow`).expect(200);
    for (const f of view.body.analysis.flags) {
      await post(staff.analyst, `/cashflow/flags/${f.id}`, {
        outcome: 'CONFIRMED',
        note: 'MoKash shows on the statement',
      }).expect(200);
    }
    const done = await post(staff.analyst, `/cashflow/analyses/${analysisId}/review`, {
      confirmedIncome: '580,000',
      note: 'Matches what the borrower told us',
    }).expect(200);
    expect(done.body.analysis.status).toBe('REVIEWED');
    expect(done.body.application.verifiedIncome).toBe('580000');
    const borrower = await prisma.borrower.findFirstOrThrow({
      where: { companyId: E2E_COMPANY_ID, fullName: 'Aline Uwase' },
      orderBy: { createdAt: 'desc' },
    });
    expect(borrower.monthlyIncome).toBe(580_000n);
    // Nothing more can change on a reviewed analysis.
    await post(staff.analyst, `/cashflow/analyses/${analysisId}/review`, {
      confirmedIncome: '1',
    }).expect(409);
    const pilot = await get(staff.auditor, '/cashflow/pilot').expect(200);
    expect(pilot.body.reviewed).toBeGreaterThan(0);
  });

  it('reads PDFs with AI, compares the payslip with salary received, and spots reused files', async () => {
    const other = await newApplication('Jean Paul Nkusi');
    const pdf = Buffer.from('%PDF-1.4 statement for test');
    const payslip = Buffer.from('%PDF-1.4 payslip for test');
    await upload(staff.analyst, other, 'BANK_STATEMENT', 'bank.pdf', pdf).expect(201);
    await upload(staff.analyst, other, 'PAYSLIP', 'payslip.pdf', payslip).expect(201);
    // The same MoMo export as the first borrower's.
    await upload(staff.analyst, other, 'MOMO_STATEMENT', 'momo.csv', momoCsv()).expect(201);
    await post(staff.analyst, `/applications/${other}/cashflow/consent`).expect(201);
    fake.queue.push(
      {
        readable: true,
        accountHolder: 'NKUSI Jean Paul',
        transactions: ['2026-08-25', '2026-09-25', '2026-10-25'].map((date) => ({
          date,
          description: 'SALARY MINISTRY',
          amount: '300000',
          direction: 'IN',
          balance: null,
        })),
      },
      {
        readable: true,
        employer: 'Ministry',
        employeeName: 'Jean Paul Nkusi',
        payPeriod: '2026-10',
        gross: '520000',
        deductions: '120000',
        net: '400000',
      },
    );
    const res = await post(staff.analyst, `/applications/${other}/cashflow/analyse`).expect(200);
    expect(fake.seenFiles).toEqual(['application/pdf', 'application/pdf']);
    const docs = res.body.documents;
    expect(docs.map((d: { status: string }) => d.status)).toEqual(['READ', 'READ', 'READ']);
    expect(docs[1].payslip).toMatchObject({ net: '400000' });
    const codes = res.body.analysis.flags.map((f: { code: string }) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['PAYSLIP_MISMATCH', 'DUPLICATE_DOCUMENT']));
    expect(codes).not.toContain('NAME_MISMATCH');
    expect(res.body.analysis.report.averageIncome.confidence).toBe('LOW');
  });

  it('never blocks an application: unreadable documents fall back to manual review', async () => {
    const third = await newApplication('Manual Review');
    fake.configured = false;
    try {
      await upload(
        staff.analyst,
        third,
        'BANK_STATEMENT',
        'scan.pdf',
        Buffer.from('%PDF-1.4 x'),
      ).expect(201);
      await post(staff.analyst, `/applications/${third}/cashflow/consent`).expect(201);
      const res = await post(staff.analyst, `/applications/${third}/cashflow/analyse`).expect(200);
      expect(res.body.analysis.status).toBe('FAILED');
      expect(res.body.documents[0].error).toMatch(/Review it by hand/);
      // The application can still move through the pipeline.
      await post(staff.officer, `/applications/${third}/move`, { to: 'UNDER_REVIEW' }).expect(200);
    } finally {
      fake.configured = true;
    }
  });

  it('refuses files that are not what they claim to be', async () => {
    const code2 = await newApplication('Wrong File');
    await upload(staff.analyst, code2, 'BANK_STATEMENT', 'fake.pdf', 'not really a pdf').expect(
      400,
    );
    await upload(staff.analyst, code2, 'PAYSLIP', 'slip.csv', 'a,b\r\n').expect(400);
  });
});
