import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  addMonths,
  classifyByDpd,
  type CreditClassProfile,
  crossRowProblems,
  daysPastDue,
  type IsoDate,
  isoToUtcDate,
  kigaliDate,
  type LoanTerms,
  mapHeaders,
  MIGRATION_COLUMNS,
  type MigrationRow,
  parseCsv,
  parseMigrationRow,
  quoteLoan,
  type RowResult,
  utcDateToIso,
} from '@kora/core';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { nextBorrowerCode, nextLoanCode } from '../common/codes';
import { PiiCrypto } from '../common/pii-crypto';
import type { Prisma } from '../generated/prisma/client';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { productTerms } from '../products/terms';
import { requireCompanyId } from '../tenancy/company-context';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;

/** A row as stored on the batch: bigints as digit strings. */
type StoredRow = Record<keyof MigrationRow, string | number | null> & { line: number };

/**
 * Bringing the lender's existing loan book in from spreadsheets (PRD §6.14):
 * check a file, list every problem, import a clean file in one transaction
 * with opening ledger balances, reconcile loan by loan, and sign off by a
 * second person.
 */
@Injectable()
export class MigrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly crypto: PiiCrypto,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const rows = await this.prisma.migrationBatch.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        fileName: true,
        asOf: true,
        status: true,
        rowCount: true,
        totalOutstanding: true,
        createdAt: true,
        importedAt: true,
        signedOffAt: true,
      },
    });
    return rows.map((r) => ({ ...r, asOf: utcDateToIso(r.asOf) }));
  }

  async get(id: string) {
    const batch = await this.prisma.migrationBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('No such upload');
    const names = await this.names(
      [batch.createdById, batch.importedById, batch.signedOffById].filter((x): x is string => !!x),
    );
    return {
      id: batch.id,
      fileName: batch.fileName,
      asOf: utcDateToIso(batch.asOf),
      status: batch.status,
      rowCount: batch.rowCount,
      totalOutstanding: batch.totalOutstanding,
      problems: batch.problems as Array<{ line: number; errors: string[] }>,
      rows: (batch.rows as unknown as StoredRow[]).slice(0, 500).map((r) => ({
        line: r.line,
        loanRef: r.loanRef,
        borrowerName: r.borrowerName,
        productCode: r.productCode,
        outstandingPrincipal: r.outstandingPrincipal,
        arrearsPrincipal: r.arrearsPrincipal,
        nextDueDate: r.nextDueDate,
        remainingInstalments: r.remainingInstalments,
      })),
      createdBy: names.get(batch.createdById) ?? null,
      createdById: batch.createdById,
      createdAt: batch.createdAt.toISOString(),
      importedBy: batch.importedById ? (names.get(batch.importedById) ?? null) : null,
      importedById: batch.importedById,
      importedAt: batch.importedAt?.toISOString() ?? null,
      signedOffBy: batch.signedOffById ? (names.get(batch.signedOffById) ?? null) : null,
      signedOffAt: batch.signedOffAt?.toISOString() ?? null,
    };
  }

  /** Check a file and keep the result. Nothing is imported yet. */
  async check(
    input: { fileName: string; buffer: Buffer; asOf?: IsoDate },
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const asOf = input.asOf ?? kigaliDate();
    if (asOf > kigaliDate())
      throw new BadRequestException('The cut-over date cannot be in the future');
    const buffer = input.buffer;
    if (buffer.length === 0) throw new BadRequestException('The file is empty');
    if (buffer.length > MAX_BYTES) throw new BadRequestException('The file is larger than 5 MB');

    const table = await readTable(input.fileName, buffer);
    if (table.length < 2) throw new BadRequestException('The file has no rows under the header');
    if (table.length - 1 > MAX_ROWS) {
      throw new BadRequestException(`Import at most ${MAX_ROWS} loans per file`);
    }
    const { index, missing } = mapHeaders(table[0]!);
    if (missing.length) {
      throw new BadRequestException(
        `These columns are missing: ${missing.join(', ')}. Download the template to see them all.`,
      );
    }

    const results: RowResult[] = table.slice(1).map((cells, i) => {
      const record: Record<string, string> = {};
      for (const col of MIGRATION_COLUMNS) {
        const at = index.get(col.header);
        record[col.header] = at == null ? '' : (cells[at] ?? '');
      }
      return parseMigrationRow(record, i + 2, asOf);
    });
    const cross = crossRowProblems(results);
    const dbProblems = await this.databaseProblems(results.flatMap((r) => (r.row ? [r] : [])));
    const problems: Array<{ line: number; errors: string[] }> = [];
    for (const r of results) {
      const errors = [...r.errors, ...(cross.get(r.line) ?? []), ...(dbProblems.get(r.line) ?? [])];
      if (errors.length) problems.push({ line: r.line, errors });
    }
    const clean = results.filter((r) => r.row) as Array<RowResult & { row: MigrationRow }>;
    const totalOutstanding = clean.reduce((s, r) => s + r.row.outstandingPrincipal, 0n);

    const batch = await this.prisma.migrationBatch.create({
      data: {
        fileName: input.fileName.slice(0, 200),
        asOf: isoToUtcDate(asOf),
        status: problems.length ? 'INVALID' : 'VALIDATED',
        rowCount: results.length,
        rows: clean.map((r) => storeRow(r.line, r.row)),
        problems,
        totalOutstanding,
        createdById: user.id,
      },
    });
    await this.audit.record({
      action: 'migration.check',
      actorId: user.id,
      entityType: 'MigrationBatch',
      entityId: batch.id,
      metadata: { rows: results.length, problems: problems.length },
      ...meta,
    });
    return this.get(batch.id);
  }

  /** Create every loan in a clean upload, in one transaction. */
  async import(id: string, user: AuthUser, meta: RequestMeta) {
    const batch = await this.prisma.migrationBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('No such upload');
    if (batch.status !== 'VALIDATED') {
      throw new ConflictException(
        batch.status === 'INVALID'
          ? 'Fix the problems in the spreadsheet and upload it again'
          : 'This upload has already been imported',
      );
    }
    const asOf = utcDateToIso(batch.asOf);
    const rows = (batch.rows as unknown as StoredRow[]).map(loadRow);
    const again = await this.databaseProblems(
      rows.map((r) => ({ line: r.line, row: r.row, errors: [] })),
    );
    if (again.size) {
      throw new ConflictException(
        `Something changed since the file was checked (line ${[...again.keys()][0]}: ${[...again.values()][0]![0]}). Upload it again.`,
      );
    }

    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: requireCompanyId() },
      select: { creditClassProfile: true },
    });
    const products = new Map((await this.prisma.product.findMany()).map((p) => [p.code, p]));
    const officers = new Map(
      (await this.prisma.user.findMany({ where: { isActive: true } })).map((u) => [
        u.email.toLowerCase(),
        u,
      ]),
    );

    await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.migrationBatch.updateMany({
          where: { id, status: 'VALIDATED' },
          data: { status: 'IMPORTED', importedById: user.id, importedAt: new Date() },
        });
        if (claimed.count !== 1)
          throw new ConflictException('This upload is already being imported');

        for (const { row } of rows) {
          const product = products.get(row.productCode)!;
          const officer = row.officerEmail ? officers.get(row.officerEmail) : undefined;
          const borrowerId = await this.borrowerFor(tx, row, officer?.id ?? null);
          const schedule = buildSchedule(row, productTerms(product));
          const dpd = daysPastDue(schedule.firstUnpaidDue, asOf);
          const loan = await tx.loan.create({
            data: {
              code: await nextLoanCode(tx, row.disbursedOn.slice(0, 4)),
              borrowerId,
              productId: product.id,
              principal: row.principal,
              annualRateBps: row.annualRateBps,
              termMonths: row.termMonths,
              instalmentAmount: schedule.instalment,
              status: 'ACTIVE',
              disbursedOn: isoToUtcDate(row.disbursedOn),
              firstDueDate: isoToUtcDate(schedule.rows[0]!.dueDate),
              maturityDate: isoToUtcDate(schedule.rows[schedule.rows.length - 1]!.dueDate),
              terms: schedule.terms as object,
              productVersion: product.version,
              collateral: row.collateral,
              officerId: officer?.id ?? null,
              creditClass: classifyByDpd(dpd, company.creditClassProfile as CreditClassProfile),
              classifiedOn: isoToUtcDate(asOf),
              migratedRef: row.loanRef,
              migrationBatchId: id,
              instalments: {
                create: schedule.rows.map((r) => ({
                  number: r.number,
                  dueDate: isoToUtcDate(r.dueDate),
                  periodStart: isoToUtcDate(r.periodStart),
                  principalDue: r.principal,
                  interestDue: r.interest,
                  interestAccrued: r.accrued,
                })),
              },
            },
          });
          if (row.guarantorName) {
            await tx.loanGuarantor.create({
              data: { loanId: loan.id, fullName: row.guarantorName, phone: row.guarantorPhone },
            });
          }
          await this.ledger.post(tx, {
            type: 'OPENING_BALANCE',
            idempotencyKey: `migration:${id}:${row.loanRef}`,
            loanId: loan.id,
            effectiveOn: asOf,
            memo: `Opening balance for ${row.loanRef} (migrated)`,
            postedById: user.id,
            lines: [
              { account: 'LOANS_PRINCIPAL', direction: 'DEBIT', amount: row.outstandingPrincipal },
              { account: 'INTEREST_RECEIVABLE', direction: 'DEBIT', amount: row.arrearsInterest },
              {
                account: 'OPENING_BALANCES',
                direction: 'CREDIT',
                amount: row.outstandingPrincipal + row.arrearsInterest,
              },
            ],
          });
        }
        await this.audit.record(
          {
            action: 'migration.import',
            actorId: user.id,
            entityType: 'MigrationBatch',
            entityId: id,
            metadata: { loans: rows.length, outstanding: batch.totalOutstanding.toString() },
            ...meta,
          },
          tx,
        );
      },
      { timeout: 300_000, maxWait: 20_000 },
    );
    return this.get(id);
  }

  /** Loan by loan: the file's balances against what the ledger now holds. */
  async reconciliation(id: string) {
    const batch = await this.prisma.migrationBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('No such upload');
    const rows = (batch.rows as unknown as StoredRow[]).map(loadRow);
    const loans = await this.prisma.loan.findMany({
      where: { migrationBatchId: id },
      select: { id: true, code: true, migratedRef: true },
    });
    const byRef = new Map(loans.map((l) => [l.migratedRef, l]));
    const items = [];
    let matched = 0;
    for (const { line, row } of rows) {
      const loan = byRef.get(row.loanRef);
      const principal = loan ? await this.ledger.outstandingPrincipal(loan.id) : 0n;
      const interest = loan ? await this.ledger.outstandingInterestReceivable(loan.id) : 0n;
      // Balances move once repayments start, so compare the opening posting.
      const opening = loan ? await this.openingPrincipal(loan.id) : 0n;
      const ok = !!loan && opening === row.outstandingPrincipal;
      if (ok) matched++;
      items.push({
        line,
        loanRef: row.loanRef,
        loanCode: loan?.code ?? null,
        borrowerName: row.borrowerName,
        sheetOutstanding: row.outstandingPrincipal,
        openingPrincipal: opening,
        currentPrincipal: principal,
        sheetArrearsInterest: row.arrearsInterest,
        currentInterestReceivable: interest,
        matches: ok,
      });
    }
    const ledgerTotal = items.reduce((s, i) => s + i.openingPrincipal, 0n);
    return {
      id,
      status: batch.status,
      loans: items.length,
      matched,
      sheetTotal: batch.totalOutstanding,
      ledgerTotal,
      allMatch: matched === items.length && ledgerTotal === batch.totalOutstanding,
      items,
    };
  }

  async signOff(id: string, user: AuthUser, meta: RequestMeta) {
    const batch = await this.prisma.migrationBatch.findUnique({ where: { id } });
    if (!batch) throw new NotFoundException('No such upload');
    if (batch.status !== 'IMPORTED')
      throw new ConflictException('Only an imported upload can be signed off');
    if (batch.importedById === user.id || batch.createdById === user.id) {
      throw new ForbiddenException('Someone other than the person who imported it must sign off');
    }
    const rec = await this.reconciliation(id);
    if (!rec.allMatch) {
      throw new ConflictException(`${rec.loans - rec.matched} loan(s) do not match the file`);
    }
    await this.prisma.migrationBatch.update({
      where: { id },
      data: { status: 'SIGNED_OFF', signedOffById: user.id, signedOffAt: new Date() },
    });
    await this.audit.record({
      action: 'migration.sign_off',
      actorId: user.id,
      entityType: 'MigrationBatch',
      entityId: id,
      metadata: { loans: rec.loans, total: rec.sheetTotal.toString() },
      ...meta,
    });
    return this.get(id);
  }

  // ── helpers ───────────────────────────────────────────────────────

  /** Checks that need the database: products, duplicates, staff and IDs. */
  private async databaseProblems(results: Array<{ line: number; row: MigrationRow | null }>) {
    const out = new Map<number, string[]>();
    const add = (line: number, msg: string) => out.set(line, [...(out.get(line) ?? []), msg]);
    const rows = results.filter((r): r is { line: number; row: MigrationRow } => !!r.row);
    if (!rows.length) return out;

    const products = new Map(
      (await this.prisma.product.findMany({ select: { code: true, terms: true } })).map((p) => [
        p.code,
        p,
      ]),
    );
    const refs = new Set(
      (
        await this.prisma.loan.findMany({
          where: { migratedRef: { in: rows.map((r) => r.row.loanRef) } },
          select: { migratedRef: true },
        })
      ).map((l) => l.migratedRef),
    );
    const emails = new Set(
      (await this.prisma.user.findMany({ where: { isActive: true }, select: { email: true } })).map(
        (u) => u.email.toLowerCase(),
      ),
    );
    const phones = new Map(
      (
        await this.prisma.borrower.findMany({
          where: { phone: { in: [...new Set(rows.map((r) => r.row.phone))] } },
          select: { phone: true, nationalIdHash: true },
        })
      ).map((b) => [b.phone, b]),
    );
    const idHashes = rows.flatMap((r) =>
      r.row.nationalId ? [this.crypto.lookupHash(r.row.nationalId)] : [],
    );
    const idOwners = new Map(
      (
        await this.prisma.borrower.findMany({
          where: { nationalIdHash: { in: idHashes } },
          select: { phone: true, nationalIdHash: true },
        })
      ).map((b) => [b.nationalIdHash, b.phone]),
    );

    for (const { line, row } of rows) {
      if (!products.has(row.productCode)) add(line, `There is no product ${row.productCode}`);
      if (refs.has(row.loanRef)) add(line, `Loan ${row.loanRef} has already been imported`);
      if (row.officerEmail && !emails.has(row.officerEmail))
        add(line, `No active staff member has the email ${row.officerEmail}`);
      if (row.nationalId) {
        const owner = idOwners.get(this.crypto.lookupHash(row.nationalId));
        if (owner && owner !== row.phone)
          add(line, 'This national ID belongs to a borrower with a different phone');
        const existing = phones.get(row.phone);
        if (
          existing?.nationalIdHash &&
          existing.nationalIdHash !== this.crypto.lookupHash(row.nationalId)
        )
          add(line, 'This phone belongs to a borrower with a different national ID');
      }
    }
    return out;
  }

  private async borrowerFor(
    tx: Prisma.TransactionClient,
    row: MigrationRow,
    officerId: string | null,
  ): Promise<string> {
    const existing = await tx.borrower.findFirst({ where: { phone: row.phone } });
    if (existing) {
      if (row.nationalId && !existing.nationalIdHash) {
        await tx.borrower.update({
          where: { id: existing.id },
          data: {
            nationalIdEnc: this.crypto.encrypt(row.nationalId),
            nationalIdHash: this.crypto.lookupHash(row.nationalId),
            nationalIdLast3: row.nationalId.slice(-3),
          },
        });
      }
      return existing.id;
    }
    const created = await tx.borrower.create({
      data: {
        code: await nextBorrowerCode(tx),
        fullName: row.borrowerName,
        phone: row.phone,
        gender: row.gender ?? 'UNDISCLOSED',
        district: row.district,
        officerId,
        customerSince: isoToUtcDate(row.disbursedOn),
        ...(row.nationalId
          ? {
              nationalIdEnc: this.crypto.encrypt(row.nationalId),
              nationalIdHash: this.crypto.lookupHash(row.nationalId),
              nationalIdLast3: row.nationalId.slice(-3),
            }
          : {}),
      },
    });
    return created.id;
  }

  private async openingPrincipal(loanId: string): Promise<bigint> {
    const rows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COALESCE(SUM(e."amount"), 0)::bigint AS total
      FROM "LedgerEntry" e
      JOIN "LedgerTransaction" t ON t."id" = e."transactionId"
      JOIN "LedgerAccount" a ON a."id" = e."accountId"
      WHERE t."loanId" = ${loanId}::uuid AND t."type" = 'OPENING_BALANCE'
        AND a."code" = '1100' AND e."direction" = 'DEBIT'`;
    return rows[0]?.total ?? 0n;
  }

  private async names(ids: string[]) {
    if (!ids.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  }
}

// ── file reading and schedules ─────────────────────────────────────────

/** The sheet's cells as text, first row the header. CSV or Excel. */
async function readTable(fileName: string, buffer: Buffer): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return parseCsv(buffer.toString('utf8'));
  if (!lower.endsWith('.xlsx')) {
    throw new BadRequestException('Upload a .xlsx or .csv file (save older .xls files as .xlsx)');
  }
  const book = new ExcelJS.Workbook();
  try {
    await book.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException('This file could not be read as an Excel workbook');
  }
  const sheet = book.worksheets[0];
  if (!sheet) throw new BadRequestException('The workbook has no sheets');
  const out: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    const count = row.cellCount;
    for (let c = 1; c <= count; c++) cells.push(cellText(row.getCell(c).value));
    if (cells.some((v) => v.trim() !== '')) out.push(cells);
  });
  return out;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value && value.result != null)
      return cellText(value.result as ExcelJS.CellValue);
    if ('text' in value) return String(value.text);
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    return '';
  }
  return String(value);
}

interface ImportRow {
  number: number;
  dueDate: IsoDate;
  periodStart: IsoDate;
  principal: bigint;
  interest: bigint;
  accrued: bigint;
}

/**
 * The schedule a migrated loan continues on: any arrears as one overdue
 * instalment, then the remaining instalments on the reducing balance at the
 * loan's rate, monthly from the next due date.
 */
export function buildSchedule(row: MigrationRow, productRules: LoanTerms) {
  const terms: LoanTerms = {
    ...productRules,
    interestMethod: 'DECLINING_EQUAL_INSTALMENT',
    rateBps: row.annualRateBps,
    ratePeriod: 'YEAR',
    frequency: 'MONTHLY',
    dueDayOfMonth: null,
    moveOffNonWorkingDays: false,
    principalGracePeriods: 0,
    fees: [],
  };
  const rows: ImportRow[] = [];
  const hasArrears = row.arrearsPrincipal > 0n || row.arrearsInterest > 0n;
  if (hasArrears) {
    rows.push({
      number: 1,
      dueDate: row.oldestArrearsDate!,
      periodStart: row.oldestArrearsDate!,
      principal: row.arrearsPrincipal,
      interest: row.arrearsInterest,
      accrued: row.arrearsInterest,
    });
  }
  const rest = row.outstandingPrincipal - row.arrearsPrincipal;
  let instalment = row.arrearsPrincipal + row.arrearsInterest;
  if (row.remainingInstalments > 0 && rest > 0n && row.nextDueDate) {
    const start = addMonths(row.nextDueDate, -1);
    const quote = quoteLoan({
      amount: rest,
      count: row.remainingInstalments,
      terms,
      disbursedOn: start,
    });
    instalment = quote.instalment;
    quote.rows.forEach((r, i) =>
      rows.push({
        number: rows.length + 1,
        dueDate: r.dueDate,
        periodStart: i === 0 ? start : quote.rows[i - 1]!.dueDate,
        principal: r.principal,
        interest: r.interest,
        accrued: 0n,
      }),
    );
  }
  return {
    terms,
    rows,
    instalment,
    firstUnpaidDue: rows[0]?.dueDate ?? null,
  };
}

function storeRow(line: number, row: MigrationRow): StoredRow {
  const out: Record<string, string | number | null> = { line };
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'bigint' ? v.toString() : v;
  return out as StoredRow;
}

const BIGINTS: Array<keyof MigrationRow> = [
  'principal',
  'outstandingPrincipal',
  'arrearsPrincipal',
  'arrearsInterest',
  'paidToDate',
];

function loadRow(stored: StoredRow): { line: number; row: MigrationRow } {
  const row: Record<string, unknown> = { ...stored };
  delete row.line;
  for (const k of BIGINTS) {
    const v = stored[k];
    row[k] = v == null ? null : BigInt(v as string);
  }
  return { line: stored.line, row: row as unknown as MigrationRow };
}
