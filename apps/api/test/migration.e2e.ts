import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { addDays, addMonths, kigaliDate, legacyTerms, MIGRATION_COLUMNS } from '@kora/core';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import type { PrismaClient, StaffRole } from '../src/generated/prisma/client';
import { ACCOUNTS } from '../src/ledger/accounts';
import { signInWithSms, smsTwoFactor } from './sign-in';
import { byCode, E2E_COMPANY_ID, testPrisma } from './test-db';

/** PRD §6.14: bringing the existing loan book in from a spreadsheet. */
const PASSWORD = `e2e-${randomUUID()}`;
const PRODUCT = `E2M-${randomUUID().slice(0, 8)}`;
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const today = kigaliDate();
const tag = randomUUID().slice(0, 6);

let app: INestApplication;
let prisma: PrismaClient;
type Agent = { cookies: string[]; id: string; email: string };
const staff = {} as Record<'manager' | 'manager2' | 'accountant' | 'officer', Agent>;

const http = () => request(app.getHttpServer());
const get = (who: Agent, path: string) => http().get(path).set('Cookie', who.cookies);
const post = (who: Agent, path: string, body: object = {}) =>
  http().post(path).set('Cookie', who.cookies).set('Origin', ORIGIN).send(body);
const upload = (who: Agent, name: string, content: Buffer | string) =>
  http()
    .post('/migration/batches')
    .set('Cookie', who.cookies)
    .set('Origin', ORIGIN)
    .attach('file', Buffer.from(content), name);

async function signIn(role: StaffRole, passwordHash: string): Promise<Agent> {
  const email = `e2e-mig-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
  const factor = smsTwoFactor();
  const user = await prisma.user.create({
    data: { email, passwordHash, firstName: 'E2E', lastName: role, role, ...factor },
  });
  const res = await signInWithSms(app, { email, phone: factor.phone }, PASSWORD);
  const cookies = ([] as string[]).concat(res.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]!);
  return { cookies, id: user.id, email };
}

const phone = () => `078${randomInt(1_000_000, 9_999_999)}`;
const nextDue = addMonths(today, 1);

function rows(): Record<string, string>[] {
  return [
    {
      borrower_name: 'Migrated Current',
      phone: phone(),
      loan_ref: `OLD-${tag}-1`,
      product_code: PRODUCT,
      principal: '2,000,000',
      annual_rate_percent: '24',
      term_months: '12',
      disbursed_on: addMonths(today, -5),
      outstanding_principal: '1,250,000',
      next_due_date: nextDue,
      remaining_instalments: '7',
      guarantor_name: 'Jean Guarantor',
      officer_email: staff.officer.email,
      collateral: 'Motorbike RC 123 A',
    },
    {
      borrower_name: 'Migrated Late',
      phone: phone(),
      national_id: `11990800${randomInt(10_000_000, 99_999_999)}`,
      loan_ref: `OLD-${tag}-2`,
      product_code: PRODUCT,
      principal: '900000',
      annual_rate_percent: '30',
      term_months: '9',
      disbursed_on: addMonths(today, -6),
      outstanding_principal: '600000',
      next_due_date: nextDue,
      remaining_instalments: '3',
      arrears_principal: '150000',
      arrears_interest: '22500',
      oldest_arrears_date: addDays(today, -45),
    },
    {
      borrower_name: 'Migrated Matured',
      phone: phone(),
      loan_ref: `OLD-${tag}-3`,
      product_code: PRODUCT,
      principal: '500000',
      annual_rate_percent: '24',
      term_months: '6',
      disbursed_on: addMonths(today, -10),
      outstanding_principal: '120000',
      next_due_date: '',
      remaining_instalments: '0',
      arrears_principal: '120000',
      arrears_interest: '6000',
      oldest_arrears_date: addMonths(today, -4),
    },
  ];
}

const toCsv = (records: Record<string, string>[]) =>
  [
    MIGRATION_COLUMNS.map((c) => c.header).join(','),
    ...records.map((r) => MIGRATION_COLUMNS.map((c) => `"${r[c.header] ?? ''}"`).join(',')),
  ].join('\r\n');

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
      name: 'E2E migration product',
      shortName: 'Mig',
      kind: 'SME',
      terms: legacyTerms(2400) as object,
      annualRateBps: 2400,
      minTermMonths: 1,
      maxTermMonths: 36,
      minAmount: 10_000n,
      maxAmount: 50_000_000n,
    },
  });
  const hash = await hashPassword(PASSWORD);
  staff.manager = await signIn('MANAGER', hash);
  staff.manager2 = await signIn('MANAGER', hash);
  staff.accountant = await signIn('ACCOUNTANT', hash);
  staff.officer = await signIn('LOAN_OFFICER', hash);
});

afterAll(async () => {
  await prisma.product.updateMany({ where: { code: PRODUCT }, data: { status: 'RETIRED' } });
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-mig-' } },
    data: { isActive: false },
  });
  await app.close();
  await prisma.$disconnect();
});

describe('loan book import', () => {
  it('gives the template to download', async () => {
    const res = await get(staff.manager, '/migration/template.csv').expect(200);
    expect(res.text.split('\r\n')[0]).toBe(MIGRATION_COLUMNS.map((c) => c.header).join(','));
  });

  it('lists every problem in a bad file and refuses to import it', async () => {
    const bad = rows();
    bad[0]!.phone = '12345';
    bad[1]!.product_code = 'NO-SUCH';
    bad[2]!.loan_ref = bad[1]!.loan_ref!;
    const res = await upload(staff.manager, 'book.csv', toCsv(bad)).expect(201);
    expect(res.body.status).toBe('INVALID');
    const byLine = new Map(
      res.body.problems.map((p: { line: number; errors: string[] }) => [p.line, p.errors]),
    );
    expect(byLine.get(2)).toEqual(['Phone "12345" is not a Rwandan mobile number']);
    expect(byLine.get(3)).toEqual(['There is no product NO-SUCH']);
    expect(byLine.get(4)).toEqual(['Loan reference repeats line 3']);
    await post(staff.manager, `/migration/batches/${res.body.id}/import`).expect(409);
  });

  it('refuses a file without the required columns', async () => {
    const res = await upload(staff.manager, 'book.csv', 'name,phone\r\nA,0788\r\n').expect(400);
    expect(res.body.message).toMatch(/columns are missing: .*loan_ref/);
  });

  let batchId = '';
  it('imports a clean Excel file with opening balances, then reconciles it', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Loans');
    sheet.addRow(MIGRATION_COLUMNS.map((c) => c.header));
    for (const r of rows()) {
      sheet.addRow(
        MIGRATION_COLUMNS.map((c) => {
          const v = r[c.header] ?? '';
          // Excel users type real dates and numbers; the importer reads both.
          if (c.header === 'disbursed_on' && v) return new Date(`${v}T00:00:00Z`);
          if (c.header === 'principal') return Number(v.replace(/,/g, ''));
          return v;
        }),
      );
    }
    const buffer = Buffer.from(await book.xlsx.writeBuffer());
    const checked = await upload(staff.manager, 'loan book.xlsx', buffer).expect(201);
    expect(checked.body.problems).toEqual([]);
    expect(checked.body.status).toBe('VALIDATED');
    expect(checked.body.totalOutstanding).toBe('1970000');
    batchId = checked.body.id;

    // Only managers and admins import.
    await post(staff.accountant, `/migration/batches/${batchId}/import`).expect(403);
    const imported = await post(staff.manager, `/migration/batches/${batchId}/import`).expect(200);
    expect(imported.body.status).toBe('IMPORTED');
    await post(staff.manager, `/migration/batches/${batchId}/import`).expect(409);

    const rec = await get(staff.accountant, `/migration/batches/${batchId}/reconciliation`).expect(
      200,
    );
    expect(rec.body).toMatchObject({
      loans: 3,
      matched: 3,
      allMatch: true,
      ledgerTotal: '1970000',
    });

    // A second person signs off.
    await post(staff.manager, `/migration/batches/${batchId}/sign-off`).expect(403);
    const signed = await post(staff.accountant, `/migration/batches/${batchId}/sign-off`).expect(
      200,
    );
    expect(signed.body.status).toBe('SIGNED_OFF');
  });

  it('the migrated loans behave like any other loan', async () => {
    const loans = await prisma.loan.findMany({
      where: { migrationBatchId: batchId },
      include: { instalments: { orderBy: { number: 'asc' } }, guarantors: true },
      orderBy: { migratedRef: 'asc' },
    });
    const [current, late, matured] = loans;
    expect(current!.instalments).toHaveLength(7);
    expect(current!.instalments.reduce((s, i) => s + i.principalDue, 0n)).toBe(1_250_000n);
    expect(current!.guarantors[0]!.fullName).toBe('Jean Guarantor');
    expect(current!.officerId).toBe(staff.officer.id);
    expect(late!.instalments).toHaveLength(4);
    expect(late!.instalments[0]).toMatchObject({
      principalDue: 150_000n,
      interestDue: 22_500n,
      interestAccrued: 22_500n,
    });
    expect(late!.creditClass).toBe('WATCH');
    expect(matured!.instalments).toHaveLength(1);

    const detail = await get(staff.manager, `/loans/${late!.code}`).expect(200);
    expect(detail.body.dpd).toBe(45);
    expect(detail.body.figures.outstandingPrincipal).toBe('600000');

    // Paying the arrears clears interest first, then principal, and the books stay square.
    await post(staff.manager, `/loans/${late!.code}/payments`, {
      amount: '172500',
      channel: 'CASH',
      receivedOn: today,
      idempotencyKey: randomUUID(),
    }).expect(200);
    const after = await get(staff.manager, `/loans/${late!.code}`).expect(200);
    expect(after.body.figures.outstandingPrincipal).toBe('450000');
    expect(after.body.dpd).toBe(0);
  });

  it('will not import the same loan twice', async () => {
    const dup = rows()[0]!;
    const loan = await prisma.loan.findFirstOrThrow({ where: { migrationBatchId: batchId } });
    dup.loan_ref = loan.migratedRef!;
    const res2 = await upload(staff.manager, 'dup.csv', toCsv([dup])).expect(201);
    expect(res2.body.problems[0].errors).toContain(
      `Loan ${loan.migratedRef} has already been imported`,
    );
  });
});
