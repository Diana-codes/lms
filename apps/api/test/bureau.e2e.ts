import { randomInt, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  addDays,
  addMonths,
  BUREAU_COLUMNS,
  bureauPeriod,
  kigaliDate,
  legacyTerms,
  MIGRATION_COLUMNS,
} from '@kora/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import type { PrismaClient, StaffRole } from '../src/generated/prisma/client';
import { ACCOUNTS } from '../src/ledger/accounts';
import { signInWithSms, smsTwoFactor } from './sign-in';
import { byCode, E2E_COMPANY_ID, testPrisma } from './test-db';

/** PRD §15.6 and Appendix A.11: monthly bureau files and checks with consent. */
const PASSWORD = `e2e-${randomUUID()}`;
const PRODUCT = `E2B-${randomUUID().slice(0, 8)}`;
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
const today = kigaliDate();
const tag = randomUUID().slice(0, 6);
// Report last month; the loans come in from the old books early that month.
const month = addMonths(today, -1).slice(0, 7);
const { start, end } = bureauPeriod(month);
const asOf = addDays(start, 4);
const dueInMonth = addDays(start, 19);

let app: INestApplication;
let prisma: PrismaClient;
type Agent = { cookies: string[]; id: string; email: string };
const staff = {} as Record<'manager' | 'accountant' | 'officer' | 'auditor', Agent>;

const http = () => request(app.getHttpServer());
const get = (who: Agent, path: string) => http().get(path).set('Cookie', who.cookies);
const post = (who: Agent, path: string, body: object = {}) =>
  http().post(path).set('Cookie', who.cookies).set('Origin', ORIGIN).send(body);

async function signIn(role: StaffRole, passwordHash: string): Promise<Agent> {
  const email = `e2e-crb-${role.toLowerCase()}-${randomUUID()}@koralend.test`;
  const factor = smsTwoFactor();
  const user = await prisma.user.create({
    data: { email, passwordHash, firstName: 'E2E', lastName: role, role, ...factor },
  });
  const res = await signInWithSms(app, { email, phone: factor.phone }, PASSWORD);
  const cookies = ([] as string[]).concat(res.get('Set-Cookie') ?? []).map((c) => c.split(';')[0]!);
  return { cookies, id: user.id, email };
}

const phone = () => `078${randomInt(1_000_000, 9_999_999)}`;
const nationalId = () => `11990800${randomInt(10_000_000, 99_999_999)}`;
const ids = { current: nationalId(), late: nationalId() };
const codes = {} as Record<'current' | 'late' | 'noId', string>;

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
      name: 'E2E bureau product',
      shortName: 'CRB',
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
  staff.accountant = await signIn('ACCOUNTANT', hash);
  staff.officer = await signIn('LOAN_OFFICER', hash);
  staff.auditor = await signIn('AUDITOR', hash);

  // Three loans from the old books, as they stood early last month.
  const rows: Record<string, string>[] = [
    {
      borrower_name: 'Bureau Current',
      phone: phone(),
      national_id: ids.current,
      loan_ref: `CRB-${tag}-1`,
      product_code: PRODUCT,
      principal: '2000000',
      annual_rate_percent: '24',
      term_months: '12',
      disbursed_on: addMonths(asOf, -5),
      outstanding_principal: '1250000',
      next_due_date: dueInMonth,
      remaining_instalments: '7',
    },
    {
      borrower_name: 'Bureau Late',
      phone: phone(),
      national_id: ids.late,
      loan_ref: `CRB-${tag}-2`,
      product_code: PRODUCT,
      principal: '900000',
      annual_rate_percent: '30',
      term_months: '9',
      disbursed_on: addMonths(asOf, -6),
      outstanding_principal: '600000',
      next_due_date: dueInMonth,
      remaining_instalments: '3',
      arrears_principal: '150000',
      arrears_interest: '22500',
      oldest_arrears_date: addDays(asOf, -45),
    },
    {
      borrower_name: 'Bureau No Id',
      phone: phone(),
      loan_ref: `CRB-${tag}-3`,
      product_code: PRODUCT,
      principal: '500000',
      annual_rate_percent: '24',
      term_months: '6',
      disbursed_on: addMonths(asOf, -2),
      outstanding_principal: '400000',
      next_due_date: dueInMonth,
      remaining_instalments: '4',
    },
  ];
  const csv = [
    MIGRATION_COLUMNS.map((c) => c.header).join(','),
    ...rows.map((r) => MIGRATION_COLUMNS.map((c) => `"${r[c.header] ?? ''}"`).join(',')),
  ].join('\r\n');
  const batch = await http()
    .post('/migration/batches')
    .set('Cookie', staff.manager.cookies)
    .set('Origin', ORIGIN)
    .field('asOf', asOf)
    .attach('file', Buffer.from(csv), 'book.csv')
    .expect(201);
  expect(batch.body.problems).toEqual([]);
  await post(staff.manager, `/migration/batches/${batch.body.id}/import`).expect(200);
  const loans = await prisma.loan.findMany({
    where: { migrationBatchId: batch.body.id },
    orderBy: { migratedRef: 'asc' },
  });
  [codes.current, codes.late, codes.noId] = loans.map((l) => l.code) as [string, string, string];
});

afterAll(async () => {
  await prisma.product.updateMany({ where: { code: PRODUCT }, data: { status: 'RETIRED' } });
  await prisma.user.updateMany({
    where: { email: { startsWith: 'e2e-crb-' } },
    data: { isActive: false },
  });
  await app.close();
  await prisma.$disconnect();
});

const column = (name: string) => BUREAU_COLUMNS.findIndex((c) => c.name === name);
const rowFor = (content: string, loanCode: string) =>
  content
    .split('\r\n')
    .map((l) => l.split('|'))
    .find((cells) => cells[0] === 'D' && cells[column('AccountNumber')] === loanCode);

describe('monthly credit bureau file', () => {
  let id = '';
  let sequence = 0;

  it('only reports a month once it has ended, and only finance staff build it', async () => {
    await post(staff.accountant, '/bureau/submissions', {
      month: today.slice(0, 7),
      lenderCode: 'KL001',
    }).expect(400);
    await post(staff.officer, '/bureau/submissions', { month, lenderCode: 'KL001' }).expect(403);
    await post(staff.auditor, '/bureau/submissions', { month, lenderCode: 'KL001' }).expect(403);
  });

  it('reports balances and arrears as they stood at the month end', async () => {
    // A payment after the month end must not change last month's figures.
    await post(staff.manager, `/loans/${codes.late}/payments`, {
      amount: '172500',
      channel: 'CASH',
      receivedOn: today,
      idempotencyKey: randomUUID(),
    }).expect(200);

    const res = await post(staff.accountant, '/bureau/submissions', {
      month,
      lenderCode: 'KL001',
    }).expect(201);
    id = res.body.id;
    sequence = res.body.sequence;
    expect(res.body).toMatchObject({ month, periodEnd: end, status: 'GENERATED' });
    expect(res.body.excluded).toContainEqual({
      accountNumber: codes.noId,
      field: 'NationalId',
      message: 'No national ID on file',
    });

    const file = await get(staff.accountant, `/bureau/submissions/${id}/file`).expect(200);
    expect(file.headers['content-disposition']).toMatch(
      new RegExp(`attachment; filename="KL001_${month.replace('-', '')}_\\d{2}\\.txt"`),
    );
    const content = file.text;
    expect(content.split('\r\n')[0]).toMatch(
      new RegExp(`^H\\|KL001\\|.+\\|${end.replaceAll('-', '')}\\|`),
    );
    expect(rowFor(content, codes.noId)).toBeUndefined();

    const late = rowFor(content, codes.late)!;
    const lateLoan = await prisma.loan.findFirstOrThrow({
      where: { companyId: E2E_COMPANY_ID, code: codes.late },
      include: { instalments: { where: { supersededAt: null }, orderBy: { dueDate: 'asc' } } },
    });
    const dueInMonthAmount = (() => {
      const i = lateLoan.instalments.find((x) => x.dueDate.toISOString().startsWith(dueInMonth))!;
      return i.principalDue + i.interestDue + i.feeDue + i.penaltyDue;
    })();
    expect(late[column('NationalId')]).toBe(ids.late);
    expect(late[column('CustomerType')]).toBe('I');
    expect(late[column('CurrentBalance')]).toBe('622500');
    expect(late[column('ArrearsAmount')]).toBe((172_500n + dueInMonthAmount).toString());
    expect(late[column('DaysInArrears')]).toBe(
      String(45 + (Date.parse(end) - Date.parse(asOf)) / 86_400_000),
    );
    expect(late[column('Classification')]).toBe('W');
    expect(late[column('AccountStatus')]).toBe('A');

    const current = rowFor(content, codes.current)!;
    expect(current[column('CurrentBalance')]).toBe('1250000');
    expect(current[column('DaysInArrears')]).toBe(
      String((Date.parse(end) - Date.parse(dueInMonth)) / 86_400_000),
    );
    expect(current[column('Classification')]).toBe('N');

    // The trailer adds up the rows above it.
    const lines = content.trimEnd().split('\r\n');
    const data = lines.filter((l) => l.startsWith('D|')).map((l) => l.split('|'));
    const trailer = lines.at(-1)!.split('|');
    expect(trailer[0]).toBe('T');
    expect(Number(trailer[1])).toBe(data.length);
    expect(BigInt(trailer[2]!)).toBe(
      data.reduce((s, r) => s + BigInt(r[column('CurrentBalance')]!), 0n),
    );

    // The file is kept encrypted, and every download is logged.
    const stored = await prisma.bureauSubmission.findUniqueOrThrow({ where: { id } });
    expect(stored.fileEnc).not.toContain(ids.late);
    expect(
      await prisma.auditLog.count({ where: { action: 'bureau.download', entityId: id } }),
    ).toBe(1);
  });

  it('keeps national IDs from staff who do not handle the file', async () => {
    await get(staff.officer, `/bureau/submissions/${id}/file`).expect(403);
    await get(staff.auditor, `/bureau/submissions/${id}/file`).expect(403);
    const list = await get(staff.auditor, '/bureau/submissions').expect(200);
    expect(list.body.lastLenderCode).toBe('KL001');
    expect(JSON.stringify(list.body)).not.toContain(ids.late);
  });

  it('rebuilds an unsent file in place, and keeps a sent one unchanged', async () => {
    const again = await post(staff.accountant, '/bureau/submissions', {
      month,
      lenderCode: 'KL001',
    }).expect(201);
    expect(again.body).toMatchObject({ id, sequence });

    await post(staff.accountant, `/bureau/submissions/${id}/response`, { accepted: true }).expect(
      409,
    );
    const sent = await post(staff.accountant, `/bureau/submissions/${id}/submitted`, {
      reference: `UPL-${tag}`,
    }).expect(200);
    expect(sent.body).toMatchObject({ status: 'SUBMITTED', bureauReference: `UPL-${tag}` });
    await post(staff.accountant, `/bureau/submissions/${id}/submitted`, {
      reference: 'again',
    }).expect(409);

    await post(staff.accountant, `/bureau/submissions/${id}/response`, {
      accepted: false,
    }).expect(400);
    const answered = await post(staff.accountant, `/bureau/submissions/${id}/response`, {
      accepted: false,
      rejectedCount: 1,
      note: 'One date of birth missing',
    }).expect(200);
    expect(answered.body).toMatchObject({ status: 'REJECTED', rejectedCount: 1 });

    const correction = await post(staff.accountant, '/bureau/submissions', {
      month,
      lenderCode: 'KL001',
    }).expect(201);
    expect(correction.body.id).not.toBe(id);
    expect(correction.body.sequence).toBe(sequence + 1);
    const first = await get(staff.manager, `/bureau/submissions/${id}`).expect(200);
    expect(first.body).toMatchObject({ status: 'REJECTED', fileSha256: answered.body.fileSha256 });
  });
});

describe('credit bureau checks on an application', () => {
  let code = '';

  beforeAll(async () => {
    const res = await post(staff.officer, '/applications', {
      name: `Bureau Applicant ${tag}`,
      phone: phone(),
      productCode: PRODUCT,
      amount: '800000',
      termMonths: 6,
    }).expect(201);
    code = res.body.code;
  });

  const check = {
    subject: 'BORROWER',
    bureau: 'TransUnion Rwanda',
    reference: 'TU-123',
    score: 640,
    openLoans: 1,
    hasDefaults: false,
    summary: 'One SACCO loan, always paid on time',
    checkedOn: today,
  };

  it('needs the borrower’s consent before a result is recorded', async () => {
    const before = await get(staff.officer, `/applications/${code}/bureau`).expect(200);
    expect(before.body).toMatchObject({ consent: null, borrowerChecked: false, checks: [] });
    const refused = await post(staff.officer, `/applications/${code}/bureau/checks`, check).expect(
      400,
    );
    expect(refused.body.message).toMatch(/consent/);

    await post(staff.officer, `/applications/${code}/bureau/consent`).expect(200);
    const done = await post(staff.officer, `/applications/${code}/bureau/checks`, check).expect(
      200,
    );
    expect(done.body.consent).toMatchObject({ channel: 'OFFICER' });
    expect(done.body.borrowerChecked).toBe(true);
    expect(done.body.checks[0]).toMatchObject({ bureau: 'TransUnion Rwanda', score: 640 });
  });

  it('records a guarantor check only with a note of their consent', async () => {
    const guarantor = { ...check, subject: 'GUARANTOR', guarantorName: 'Jean Guarantor' };
    await post(staff.officer, `/applications/${code}/bureau/checks`, guarantor).expect(400);
    const res = await post(staff.officer, `/applications/${code}/bureau/checks`, {
      ...guarantor,
      consentNote: 'Signed the guarantee form with bureau consent',
      hasDefaults: true,
      summary: 'One loan written off in 2023',
    }).expect(200);
    expect(res.body.checks[0]).toMatchObject({ subject: 'GUARANTOR', hasDefaults: true });
    await post(staff.officer, `/applications/${code}/bureau/checks`, {
      ...check,
      checkedOn: addDays(today, 2),
    }).expect(400);
  });

  it('the database refuses a check without consent', async () => {
    const appRow = await prisma.application.findFirstOrThrow({
      where: { companyId: E2E_COMPANY_ID, code },
    });
    await expect(
      prisma.bureauCheck.create({
        data: {
          companyId: E2E_COMPANY_ID,
          applicationId: appRow.id,
          borrowerId: appRow.borrowerId,
          subject: 'BORROWER',
          bureau: 'X',
          hasDefaults: false,
          summary: 'no consent',
          checkedOn: new Date(),
          recordedById: staff.officer.id,
        },
      }),
    ).rejects.toThrow(/BureauCheck_consent/);
  });
});
