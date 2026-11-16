import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  arrearsAt,
  BUREAU_FORMAT_VERSION,
  type BureauLoanRecord,
  type BureauProblem,
  bureauPeriod,
  buildBureauFile,
  classifyByDpd,
  type CreditClassProfile,
  isoToUtcDate,
  kigaliDate,
  kigaliDayStart,
  addDays,
  maskPhone,
  utcDateToIso,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { PiiCrypto } from '../common/pii-crypto';
import type { BureauSubmission } from '../generated/prisma/client';
import { ACCOUNTS } from '../ledger/accounts';
import { PrismaService } from '../prisma/prisma.service';
import { companyDisplayName, requireCompanyId } from '../tenancy/company-context';

/** Wording version for consent recorded by staff on a signed form. */
const BUREAU_CONSENT_VERSION = '2026-01';

export interface BureauCheckInput {
  subject: 'BORROWER' | 'GUARANTOR';
  guarantorName?: string;
  consentNote?: string;
  bureau: string;
  reference?: string;
  score?: number;
  openLoans?: number;
  hasDefaults: boolean;
  summary: string;
  checkedOn: string;
}

@Injectable()
export class BureauService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly crypto: PiiCrypto,
  ) {}

  // ── monthly reporting ───────────────────────────────────────────────

  async list() {
    const rows = await this.prisma.bureauSubmission.findMany({
      orderBy: [{ periodEnd: 'desc' }, { sequence: 'desc' }],
      take: 60,
    });
    return rows.map((r) => this.summary(r));
  }

  async detail(id: string) {
    return this.summary(await this.find(id), true);
  }

  /** The lender code used last time, to prefill the form. */
  async lastLenderCode(): Promise<string | null> {
    const last = await this.prisma.bureauSubmission.findFirst({
      orderBy: { generatedAt: 'desc' },
      select: { lenderCode: true },
    });
    return last?.lenderCode ?? null;
  }

  /**
   * Build the file for a finished month. While the latest file for that month
   * has not been sent it is rebuilt in place; once sent, a rebuild is a new
   * sequence (a correction file) and the sent one stays as it was.
   */
  async generate(month: string, lenderCode: string, user: AuthUser, meta: RequestMeta) {
    const { start, end } = bureauPeriod(month);
    if (end >= kigaliDate()) throw new BadRequestException('Report a month once it has ended');
    const records = await this.records(start, end);
    const file = buildBureauFile(
      { lenderCode, lenderName: companyDisplayName(), periodEnd: end, createdOn: kigaliDate() },
      records,
    );
    const latest = await this.prisma.bureauSubmission.findFirst({
      where: { periodEnd: isoToUtcDate(end) },
      orderBy: { sequence: 'desc' },
    });
    const data = {
      formatVersion: BUREAU_FORMAT_VERSION,
      lenderCode,
      recordCount: file.recordCount,
      excludedCount: new Set(file.excluded.map((p) => p.accountNumber)).size,
      totalBalance: file.totalBalance,
      totalArrears: file.totalArrears,
      excluded: file.excluded as unknown as object,
      fileSha256: createHash('sha256').update(file.content).digest('hex'),
      fileEnc: this.crypto.encrypt(file.content),
      generatedById: user.id,
      generatedAt: new Date(),
    };
    const row =
      latest && latest.status === 'GENERATED'
        ? await this.prisma.bureauSubmission.update({ where: { id: latest.id }, data })
        : await this.prisma.bureauSubmission.create({
            data: { ...data, periodEnd: isoToUtcDate(end), sequence: (latest?.sequence ?? 0) + 1 },
          });
    await this.audit.record({
      action: 'bureau.generate',
      actorId: user.id,
      entityType: 'BureauSubmission',
      entityId: row.id,
      metadata: {
        month,
        sequence: row.sequence,
        records: file.recordCount,
        excluded: data.excludedCount,
        sha256: data.fileSha256,
      },
      ...meta,
    });
    return this.summary(row, true);
  }

  /** The file, decrypted for download. Every download is logged. */
  async file(id: string, user: AuthUser, meta: RequestMeta) {
    const row = await this.find(id);
    const content = this.crypto.decrypt(row.fileEnc);
    await this.audit.record({
      action: 'bureau.download',
      actorId: user.id,
      entityType: 'BureauSubmission',
      entityId: row.id,
      metadata: { sha256: row.fileSha256 },
      ...meta,
    });
    const period = utcDateToIso(row.periodEnd).slice(0, 7).replace('-', '');
    return {
      content,
      filename: `${row.lenderCode}_${period}_${String(row.sequence).padStart(2, '0')}.txt`,
    };
  }

  async markSubmitted(id: string, reference: string, user: AuthUser, meta: RequestMeta) {
    const row = await this.find(id);
    if (row.status !== 'GENERATED') throw new ConflictException('This file was already sent');
    const updated = await this.prisma.bureauSubmission.update({
      where: { id },
      data: {
        status: 'SUBMITTED',
        submittedById: user.id,
        submittedAt: new Date(),
        bureauReference: reference,
      },
    });
    await this.audit.record({
      action: 'bureau.submit',
      actorId: user.id,
      entityType: 'BureauSubmission',
      entityId: id,
      metadata: { reference, sha256: row.fileSha256 },
      ...meta,
    });
    return this.summary(updated, true);
  }

  async recordResponse(
    id: string,
    input: { accepted: boolean; rejectedCount?: number; note?: string },
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const row = await this.find(id);
    if (row.status !== 'SUBMITTED')
      throw new ConflictException('Record the bureau’s answer after the file is sent');
    if (!input.accepted && !input.note?.trim())
      throw new BadRequestException('Say what the bureau rejected');
    const updated = await this.prisma.bureauSubmission.update({
      where: { id },
      data: {
        status: input.accepted ? 'ACCEPTED' : 'REJECTED',
        respondedById: user.id,
        respondedAt: new Date(),
        rejectedCount: input.rejectedCount ?? (input.accepted ? 0 : null),
        responseNote: input.note?.trim() || null,
      },
    });
    await this.audit.record({
      action: input.accepted ? 'bureau.accepted' : 'bureau.rejected',
      actorId: user.id,
      entityType: 'BureauSubmission',
      entityId: id,
      metadata: { rejectedCount: updated.rejectedCount },
      ...meta,
    });
    return this.summary(updated, true);
  }

  private async find(id: string) {
    const row = await this.prisma.bureauSubmission.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('No such bureau file');
    return row;
  }

  private summary(r: BureauSubmission, withExcluded = false) {
    return {
      id: r.id,
      month: utcDateToIso(r.periodEnd).slice(0, 7),
      periodEnd: utcDateToIso(r.periodEnd),
      sequence: r.sequence,
      status: r.status,
      formatVersion: r.formatVersion,
      lenderCode: r.lenderCode,
      recordCount: r.recordCount,
      excludedCount: r.excludedCount,
      totalBalance: r.totalBalance,
      totalArrears: r.totalArrears,
      fileSha256: r.fileSha256,
      generatedAt: r.generatedAt,
      submittedAt: r.submittedAt,
      bureauReference: r.bureauReference,
      respondedAt: r.respondedAt,
      rejectedCount: r.rejectedCount,
      responseNote: r.responseNote,
      ...(withExcluded ? { excluded: r.excluded as unknown as BureauProblem[] } : {}),
    };
  }

  /**
   * One record per loan the bureau should hear about for the month: every
   * loan disbursed by the month end that was still open at its start, with
   * balances, arrears and status as they stood on the last day.
   */
  private async records(start: string, end: string): Promise<BureauLoanRecord[]> {
    const startDate = isoToUtcDate(start);
    const endDate = isoToUtcDate(end);
    const endInstant = kigaliDayStart(addDays(end, 1));
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: requireCompanyId() },
      select: { creditClassProfile: true },
    });
    const profile = company.creditClassProfile as CreditClassProfile;

    const loans = await this.prisma.loan.findMany({
      where: {
        disbursedOn: { not: null, lte: endDate },
        status: { in: ['ACTIVE', 'REPAID', 'WRITTEN_OFF'] },
        OR: [{ closedOn: null }, { closedOn: { gte: startDate } }],
      },
      include: {
        borrower: { include: { business: true } },
        product: { select: { name: true } },
        instalments: { where: { supersededAt: null }, orderBy: { dueDate: 'asc' } },
        payments: { where: { status: 'SUCCESSFUL' }, orderBy: { confirmedAt: 'asc' } },
        collaterals: { where: { releasedAt: null }, orderBy: { marketValue: 'desc' } },
        guarantors: { where: { releasedAt: null }, select: { id: true } },
        writeOffs: { where: { status: 'APPROVED' } },
      },
    });

    const balances = new Map<string, bigint>();
    if (loans.length) {
      const rows = await this.prisma.$queryRaw<Array<{ loanId: string; balance: bigint }>>`
        SELECT e."loanId", COALESCE(SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE -e."amount" END), 0)::bigint AS balance
        FROM "LedgerEntry" e
        JOIN "LedgerAccount" a ON a."id" = e."accountId"
        JOIN "LedgerTransaction" t ON t."id" = e."transactionId"
        WHERE a."code" IN (${ACCOUNTS.LOANS_PRINCIPAL.code}, ${ACCOUNTS.INTEREST_RECEIVABLE.code}, ${ACCOUNTS.FEES_RECEIVABLE.code})
          AND t."effectiveOn" <= ${endDate}
          AND e."loanId" = ANY(${loans.map((l) => l.id)}::uuid[])
        GROUP BY e."loanId"`;
      for (const r of rows) balances.set(r.loanId, r.balance);
    }

    const out: BureauLoanRecord[] = [];
    for (const loan of loans) {
      const writeOff = loan.writeOffs.find((w) => w.decidedAt && w.decidedAt < endInstant);
      // A write-off decided before this month started was already reported.
      if (writeOff && writeOff.decidedAt! < kigaliDayStart(start)) continue;
      const closedOn = loan.closedOn ? utcDateToIso(loan.closedOn) : null;
      const status = writeOff ? 'WRITTEN_OFF' : closedOn && closedOn <= end ? 'CLOSED' : 'ACTIVE';

      // What had been paid by the month end: what the schedule shows as paid now,
      // less anything that came in afterwards.
      const paidNow = loan.instalments.reduce(
        (s, i) => s + i.principalPaid + i.interestPaid + i.feePaid + i.penaltyPaid,
        0n,
      );
      const paidAfter = loan.payments
        .filter((p) => p.confirmedAt && p.confirmedAt >= endInstant)
        .reduce((s, p) => s + p.amount, 0n);
      const paidByThen = paidNow > paidAfter ? paidNow - paidAfter : 0n;
      const { arrearsAmount, daysInArrears } =
        status === 'ACTIVE'
          ? arrearsAt(
              loan.instalments.map((i) => ({
                dueDate: utcDateToIso(i.dueDate),
                amount: i.principalDue + i.interestDue + i.feeDue + i.penaltyDue,
              })),
              paidByThen,
              end,
            )
          : { arrearsAmount: 0n, daysInArrears: 0 };
      const lastPayment = loan.payments
        .filter((p) => p.confirmedAt && p.confirmedAt < endInstant)
        .at(-1);
      const balance = status === 'ACTIVE' ? (balances.get(loan.id) ?? 0n) : 0n;
      const b = loan.borrower;
      const main = loan.collaterals[0];

      out.push({
        borrowerType: b.type === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL',
        name: b.type === 'BUSINESS' && b.business ? b.business.name : b.fullName,
        nationalId: b.nationalIdEnc ? this.crypto.decrypt(b.nationalIdEnc) : null,
        registrationNumber: b.business?.rdbNumber ?? null,
        dateOfBirth: b.dateOfBirth ? utcDateToIso(b.dateOfBirth) : null,
        gender: b.gender,
        phone: b.phone,
        district: b.district,
        customerNumber: b.code,
        accountNumber: loan.code,
        productName: loan.product.name,
        dateOpened: utcDateToIso(loan.disbursedOn!),
        maturityDate: utcDateToIso(loan.maturityDate),
        termMonths: loan.termMonths,
        principal: loan.principal,
        instalmentAmount: loan.instalmentAmount,
        // Interest that fell due but is not yet accrued in the ledger is still owed,
        // so the balance is never below what is overdue.
        currentBalance: balance > arrearsAmount ? balance : arrearsAmount,
        arrearsAmount,
        daysInArrears,
        creditClass: writeOff ? 'LOSS' : classifyByDpd(daysInArrears, profile),
        status,
        closedOn: status === 'CLOSED' ? closedOn : null,
        writtenOffOn: writeOff ? kigaliDate(writeOff.decidedAt!) : null,
        writtenOffAmount: writeOff ? writeOff.principal + writeOff.interest : 0n,
        lastPaymentDate: lastPayment ? kigaliDate(lastPayment.confirmedAt!) : null,
        lastPaymentAmount: lastPayment?.amount ?? 0n,
        collateralType: main?.kind ?? null,
        collateralValue: main?.marketValue ?? 0n,
        guarantorCount: loan.guarantors.length,
      });
    }
    return out;
  }

  // ── checks for applicants and guarantors ─────────────────────────────

  private async application(code: string) {
    const app = await this.prisma.application.findFirst({
      where: { code },
      include: { borrower: { select: { id: true, fullName: true, phone: true } } },
    });
    if (!app) throw new NotFoundException('No such application');
    return app;
  }

  async checks(code: string) {
    const app = await this.application(code);
    const [consent, checks] = await Promise.all([
      this.prisma.consent.findFirst({
        where: { borrowerId: app.borrowerId, type: 'CREDIT_BUREAU', revokedAt: null },
        orderBy: { grantedAt: 'desc' },
      }),
      this.prisma.bureauCheck.findMany({
        where: { applicationId: app.id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      application: app.code,
      borrower: { name: app.borrower.fullName, phone: maskPhone(app.borrower.phone) },
      consent: consent
        ? {
            grantedAt: consent.grantedAt.toISOString(),
            channel: consent.channel,
            textVersion: consent.textVersion,
          }
        : null,
      borrowerChecked: checks.some((c) => c.subject === 'BORROWER'),
      checks: checks.map((c) => ({
        id: c.id,
        subject: c.subject,
        guarantorName: c.guarantorName,
        consentNote: c.consentNote,
        bureau: c.bureau,
        reference: c.reference,
        score: c.score,
        openLoans: c.openLoans,
        hasDefaults: c.hasDefaults,
        summary: c.summary,
        checkedOn: utcDateToIso(c.checkedOn),
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  /** The borrower's signed consent to a bureau check, recorded by staff. */
  async recordConsent(code: string, user: AuthUser, meta: RequestMeta) {
    const app = await this.application(code);
    await this.prisma.consent.create({
      data: {
        borrowerId: app.borrowerId,
        applicationId: app.id,
        type: 'CREDIT_BUREAU',
        textVersion: BUREAU_CONSENT_VERSION,
        channel: 'OFFICER',
        ip: meta.ip ?? null,
      },
    });
    await this.audit.record({
      action: 'bureau.consent',
      actorId: user.id,
      entityType: 'Application',
      entityId: code,
      ...meta,
    });
    return this.checks(code);
  }

  async recordCheck(code: string, input: BureauCheckInput, user: AuthUser, meta: RequestMeta) {
    const app = await this.application(code);
    if (input.checkedOn > kigaliDate())
      throw new BadRequestException('The check date cannot be in the future');
    let consentId: string | null = null;
    if (input.subject === 'BORROWER') {
      const consent = await this.prisma.consent.findFirst({
        where: { borrowerId: app.borrowerId, type: 'CREDIT_BUREAU', revokedAt: null },
        orderBy: { grantedAt: 'desc' },
      });
      if (!consent)
        throw new BadRequestException(
          'Record the borrower’s consent to a credit bureau check before recording the result',
        );
      consentId = consent.id;
    } else if (!input.guarantorName?.trim() || !input.consentNote?.trim()) {
      throw new BadRequestException('Name the guarantor and say how they gave consent');
    }
    const check = await this.prisma.bureauCheck.create({
      data: {
        applicationId: app.id,
        borrowerId: app.borrowerId,
        subject: input.subject,
        guarantorName: input.subject === 'GUARANTOR' ? input.guarantorName!.trim() : null,
        consentId,
        consentNote: input.subject === 'GUARANTOR' ? input.consentNote!.trim() : null,
        bureau: input.bureau,
        reference: input.reference?.trim() || null,
        score: input.score ?? null,
        openLoans: input.openLoans ?? null,
        hasDefaults: input.hasDefaults,
        summary: input.summary.trim(),
        checkedOn: isoToUtcDate(input.checkedOn),
        recordedById: user.id,
      },
    });
    await this.audit.record({
      action: 'bureau.check',
      actorId: user.id,
      entityType: 'Application',
      entityId: code,
      metadata: { checkId: check.id, subject: input.subject, hasDefaults: input.hasDefaults },
      ...meta,
    });
    return this.checks(code);
  }
}
