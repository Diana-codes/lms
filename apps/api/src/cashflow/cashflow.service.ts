import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  analyseCashflow,
  CASHFLOW_MODEL_VERSION,
  type CashflowCategory,
  type CashflowReport,
  type CashflowTxn,
  categorise,
  kigaliDate,
  isoToUtcDate,
  parseCsv,
  parseStatementCsv,
  parseStatementDate,
  type PayslipFacts,
  utcDateToIso,
} from '@kora/core';
import { z } from 'zod';
import { AiClient, AiUnavailableError } from '../ai/ai.client';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { ENV, type Env } from '../config/env';
import type { CashflowDocKind, FlagOutcome } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const CASHFLOW_MAX_BYTES = 10 * 1024 * 1024;
const CONSENT_VERSION = 'cashflow-v1';

const TYPES = new Map([
  ['text/csv', 'csv'],
  ['application/vnd.ms-excel', 'csv'],
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

/** What Claude returns when reading a statement. Amounts as whole RWF digits. */
const statementSchema = z.object({
  readable: z
    .boolean()
    .describe('false if this is not a bank or mobile money statement, or cannot be read'),
  accountHolder: z.string().nullable(),
  transactions: z
    .array(
      z.object({
        date: z.string().describe('YYYY-MM-DD'),
        description: z.string(),
        amount: z.string().describe('whole RWF, digits only, no sign'),
        direction: z.enum(['IN', 'OUT']),
        balance: z
          .string()
          .nullable()
          .describe('running balance after the transaction, digits, or null'),
      }),
    )
    .max(3000),
});

const payslipSchema = z.object({
  readable: z.boolean(),
  employer: z.string().nullable(),
  employeeName: z.string().nullable(),
  payPeriod: z.string().nullable().describe('YYYY-MM'),
  gross: z.string().nullable().describe('whole RWF, digits only'),
  deductions: z.string().nullable(),
  net: z.string().nullable(),
});

const digits = (v: string | null | undefined): bigint | null => {
  const t = (v ?? '').replace(/[^\d]/g, '');
  return t ? BigInt(t) : null;
};

type ReportJson = Record<string, unknown>;

/**
 * PRD §6.15: read payslips and statements, analyse cash flow and present a
 * report the credit analyst reviews. Advisory only: it never approves,
 * declines or prices, and verified income is set only by the analyst.
 */
@Injectable()
export class CashflowService {
  private readonly logger = new Logger(CashflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClient,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ── consent and documents ──────────────────────────────────────────

  async recordConsent(code: string, user: AuthUser, meta: RequestMeta) {
    const app = await this.application(code);
    await this.prisma.consent.create({
      data: {
        borrowerId: app.borrowerId,
        applicationId: app.id,
        type: 'CASHFLOW_ANALYSIS',
        textVersion: CONSENT_VERSION,
        channel: 'OFFICER',
        ip: meta.ip ?? null,
      },
    });
    await this.audit.record({
      action: 'cashflow.consent',
      actorId: user.id,
      entityType: 'Application',
      entityId: code,
      ...meta,
    });
    return this.view(code);
  }

  async upload(
    code: string,
    kind: CashflowDocKind,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const app = await this.application(code);
    const mime = file.originalname.toLowerCase().endsWith('.csv') ? 'text/csv' : file.mimetype;
    const ext = TYPES.get(mime);
    if (!ext) throw new BadRequestException('Upload a PDF, a photo (JPEG, PNG) or a CSV export');
    if (file.size > CASHFLOW_MAX_BYTES)
      throw new BadRequestException('The file must be under 10 MB');
    if (!looksLike(file.buffer, ext))
      throw new BadRequestException('The file does not match its type');
    if (kind === 'PAYSLIP' && ext === 'csv') {
      throw new BadRequestException('Upload payslips as a PDF or a photo');
    }
    const key = `cashflow/${app.borrowerId}/${randomUUID()}.${ext === 'csv' ? 'csv' : ext}`;
    const target = path.join(this.env.UPLOAD_DIR, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.buffer, { mode: 0o600 });
    const doc = await this.prisma.cashflowDocument.create({
      data: {
        applicationId: app.id,
        borrowerId: app.borrowerId,
        kind,
        fileName: file.originalname.slice(0, 200),
        mimeType: mime,
        size: file.size,
        storageKey: key,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        uploadedById: user.id,
      },
    });
    await this.audit.record({
      action: 'cashflow.document.upload',
      actorId: user.id,
      entityType: 'Application',
      entityId: code,
      metadata: { kind, size: file.size, documentId: doc.id },
      ...meta,
    });
    return this.view(code);
  }

  // ── analysis ───────────────────────────────────────────────────────

  async analyse(code: string, user: AuthUser, meta: RequestMeta) {
    await this.run(code, user.id, meta);
    return this.view(code);
  }

  /**
   * After a borrower applies in the app (or sends statements later): copy the
   * statements and payslips they sent into the application's analysis and run
   * it, with no staff member involved. Advisory only, like a staff-run analysis.
   * Returns false when there is nothing to analyse or no consent.
   */
  async autoFromBorrowerDocuments(applicationId: string): Promise<boolean> {
    const app = await this.prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      select: { id: true, code: true, borrowerId: true },
    });
    const consented = await this.prisma.consent.findFirst({
      where: { borrowerId: app.borrowerId, type: 'CASHFLOW_ANALYSIS', revokedAt: null },
    });
    if (!consented) return false;
    const kyc = await this.prisma.kycDocument.findMany({
      where: {
        borrowerId: app.borrowerId,
        type: 'FINANCIAL_STATEMENTS',
        supersededAt: null,
        storageKey: { not: null },
        status: { not: 'REJECTED' },
      },
      orderBy: { uploadedAt: 'asc' },
    });
    const have = new Set(
      (
        await this.prisma.cashflowDocument.findMany({
          where: { applicationId: app.id, kycDocumentId: { not: null } },
          select: { kycDocumentId: true },
        })
      ).map((d) => d.kycDocumentId),
    );
    let added = 0;
    for (const doc of kyc) {
      if (have.has(doc.id) || !doc.storageKey || !doc.mimeType) continue;
      if (!TYPES.has(doc.mimeType)) continue;
      let buffer: Buffer;
      try {
        buffer = await readFile(path.join(this.env.UPLOAD_DIR, doc.storageKey));
      } catch {
        continue;
      }
      await this.prisma.cashflowDocument.create({
        data: {
          applicationId: app.id,
          borrowerId: app.borrowerId,
          kind: 'BANK_STATEMENT',
          fileName: `statement-${doc.id.slice(0, 8)}.${TYPES.get(doc.mimeType)}`,
          mimeType: doc.mimeType,
          size: buffer.length,
          storageKey: doc.storageKey,
          sha256: createHash('sha256').update(buffer).digest('hex'),
          kycDocumentId: doc.id,
        },
      });
      added += 1;
    }
    const total = await this.prisma.cashflowDocument.count({ where: { applicationId: app.id } });
    if (!total) return false;
    // Nothing new since the last run: keep the analysis staff may be reviewing.
    if (!added) {
      const current = await this.prisma.cashflowAnalysis.findFirst({
        where: { applicationId: app.id, status: { not: 'SUPERSEDED' } },
      });
      if (current) return true;
    }
    await this.run(app.code, null, {});
    return true;
  }

  private async run(code: string, actorId: string | null, meta: RequestMeta) {
    const app = await this.application(code);
    const consented = await this.prisma.consent.findFirst({
      where: { borrowerId: app.borrowerId, type: 'CASHFLOW_ANALYSIS', revokedAt: null },
    });
    if (!consented) {
      throw new ConflictException(
        'Record the borrower’s consent to automated analysis of their documents first',
      );
    }
    const docs = await this.prisma.cashflowDocument.findMany({
      where: { applicationId: app.id },
      orderBy: { createdAt: 'asc' },
    });
    if (!docs.length) throw new ConflictException('Upload at least one payslip or statement first');

    await this.prisma.cashflowAnalysis.updateMany({
      where: {
        applicationId: app.id,
        status: { in: ['READY_FOR_REVIEW', 'FAILED', 'PROCESSING'] },
      },
      data: { status: 'SUPERSEDED' },
    });
    const analysis = await this.prisma.cashflowAnalysis.create({
      data: {
        applicationId: app.id,
        borrowerId: app.borrowerId,
        modelVersion: CASHFLOW_MODEL_VERSION,
        extractors: [],
        createdById: actorId,
      },
    });

    const extractors: Array<{ documentId: string; extractor: string | null; status: string }> = [];
    const txns: Array<Omit<CashflowTxn, 'id' | 'category'>> = [];
    const payslips: PayslipFacts[] = [];
    const holderNames: Array<{ documentId: string; name: string }> = [];
    const aiRead: string[] = [];
    for (const doc of docs) {
      const result = await this.read(doc);
      extractors.push({ documentId: doc.id, extractor: result.extractor, status: result.status });
      await this.prisma.cashflowDocument.update({
        where: { id: doc.id },
        data: {
          status: result.status,
          extractor: result.extractor,
          holderName: result.holderName,
          payslip: result.payslip
            ? Object.fromEntries(
                Object.entries(result.payslip).map(([k, v]) => [
                  k,
                  typeof v === 'bigint' ? v.toString() : v,
                ]),
              )
            : undefined,
          error: result.error,
        },
      });
      if (result.status !== 'READ') continue;
      txns.push(...result.txns);
      if (result.payslip) payslips.push(result.payslip);
      if (result.holderName) holderNames.push({ documentId: doc.id, name: result.holderName });
      if (result.extractor !== 'csv-v1') aiRead.push(doc.id);
    }

    // The same file for another borrower is a fraud signal.
    const duplicates = await this.prisma.cashflowDocument.findMany({
      where: { sha256: { in: docs.map((d) => d.sha256) }, borrowerId: { not: app.borrowerId } },
      select: { sha256: true },
    });
    const dupHashes = new Set(duplicates.map((d) => d.sha256));
    const duplicateDocumentIds = docs.filter((d) => dupHashes.has(d.sha256)).map((d) => d.id);

    // Store the transactions first so every figure can point at their ids.
    const stored = await this.prisma.$transaction(
      txns.map((t, i) => {
        const category = categorise(t.description, t.direction);
        return this.prisma.cashflowTransaction.create({
          data: {
            analysisId: analysis.id,
            documentId: t.documentId,
            date: isoToUtcDate(t.date),
            description: t.description.slice(0, 300),
            amount: t.amount,
            direction: t.direction,
            balance: t.balance,
            category,
            suggestedCategory: category,
            position: i,
          },
        });
      }),
    );

    const readable = extractors.some((e) => e.status === 'READ');
    const report = await this.report(analysis.id, app, {
      payslips,
      holderNames,
      duplicateDocumentIds,
      aiReadDocumentIds: aiRead,
    });
    await this.prisma.$transaction([
      this.prisma.cashflowFlag.createMany({
        data: report.flags.map((f) => ({
          analysisId: analysis.id,
          code: f.code,
          severity: f.severity,
          message: f.message,
          evidence: f.evidence,
        })),
      }),
      this.prisma.cashflowAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: readable ? 'READY_FOR_REVIEW' : 'FAILED',
          extractors,
          report: toJson(report),
          aiAverageIncome: report.averageIncome.value,
          error: readable
            ? null
            : 'None of the documents could be read. Continue with a manual review of the documents.',
        },
      }),
    ]);
    await this.audit.record({
      action: 'cashflow.analyse',
      ...(actorId ? { actorId } : { actorType: 'SYSTEM' as const }),
      entityType: 'Application',
      entityId: code,
      metadata: {
        analysisId: analysis.id,
        modelVersion: CASHFLOW_MODEL_VERSION,
        extractors: extractors.map((e) => e.extractor),
        transactions: stored.length,
        flags: report.flags.length,
      },
      ...meta,
    });
    return analysis.id;
  }

  /** An analyst changes a transaction's category; the report is worked out again. */
  async correct(
    id: string,
    category: CashflowCategory,
    reason: string,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const txn = await this.prisma.cashflowTransaction.findUnique({
      where: { id },
      include: { analysis: true },
    });
    if (!txn) throw new NotFoundException('No such transaction');
    if (txn.analysis.status !== 'READY_FOR_REVIEW') {
      throw new ConflictException('This analysis is no longer open for review');
    }
    await this.prisma.cashflowTransaction.update({
      where: { id },
      data: {
        category,
        correctedById: user.id,
        correctedAt: new Date(),
        correctionReason: reason.trim(),
      },
    });
    const app = await this.prisma.application.findUniqueOrThrow({
      where: { id: txn.analysis.applicationId },
      include: { borrower: true, product: true },
    });
    const prev = txn.analysis.report as ReportJson | null;
    const report = await this.report(txn.analysisId, app, (prev?.inputs as never) ?? undefined);
    await this.syncFlags(txn.analysisId, report);
    await this.prisma.cashflowAnalysis.update({
      where: { id: txn.analysisId },
      data: { report: toJson(report), aiAverageIncome: report.averageIncome.value },
    });
    await this.audit.record({
      action: 'cashflow.transaction.correct',
      actorId: user.id,
      entityType: 'Application',
      entityId: app.code,
      metadata: { transactionId: id, from: txn.category, to: category, reason: reason.trim() },
      ...meta,
    });
    return this.view(app.code);
  }

  async decideFlag(
    id: string,
    outcome: Exclude<FlagOutcome, 'PENDING'>,
    note: string,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const flag = await this.prisma.cashflowFlag.findUnique({
      where: { id },
      include: { analysis: true },
    });
    if (!flag) throw new NotFoundException('No such flag');
    if (flag.analysis.status !== 'READY_FOR_REVIEW') {
      throw new ConflictException('This analysis is no longer open for review');
    }
    await this.prisma.cashflowFlag.update({
      where: { id },
      data: { outcome, outcomeNote: note.trim(), reviewedById: user.id, reviewedAt: new Date() },
    });
    const app = await this.prisma.application.findUniqueOrThrow({
      where: { id: flag.analysis.applicationId },
    });
    await this.audit.record({
      action: 'cashflow.flag.decide',
      actorId: user.id,
      entityType: 'Application',
      entityId: app.code,
      metadata: { flag: flag.code, outcome },
      ...meta,
    });
    return this.view(app.code);
  }

  /**
   * The analyst's review: every flag needs an outcome, and the analyst enters
   * the income they are confident in. That figure, not the AI's, becomes the
   * borrower's verified income for the affordability rule.
   */
  async review(
    id: string,
    confirmedIncome: bigint,
    note: string,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const analysis = await this.prisma.cashflowAnalysis.findUnique({
      where: { id },
      include: { flags: true },
    });
    if (!analysis) throw new NotFoundException('No such analysis');
    if (analysis.status !== 'READY_FOR_REVIEW') {
      throw new ConflictException('This analysis is not waiting for review');
    }
    const open = analysis.flags.filter((f) => f.outcome === 'PENDING');
    if (open.length) {
      throw new ConflictException(`Record an outcome for each flag first (${open.length} open)`);
    }
    const app = await this.prisma.application.findUniqueOrThrow({
      where: { id: analysis.applicationId },
    });
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.cashflowAnalysis.updateMany({
        where: { id, status: 'READY_FOR_REVIEW' },
        data: {
          status: 'REVIEWED',
          confirmedIncome,
          reviewNote: note.trim() || null,
          reviewedById: user.id,
          reviewedAt: new Date(),
        },
      });
      if (claimed.count !== 1)
        throw new ConflictException('This analysis has already been reviewed');
      await tx.borrower.update({
        where: { id: analysis.borrowerId },
        data: { monthlyIncome: confirmedIncome, incomeVerifiedAt: new Date() },
      });
      await this.audit.record(
        {
          action: 'cashflow.review',
          actorId: user.id,
          entityType: 'Application',
          entityId: app.code,
          metadata: {
            analysisId: id,
            confirmedIncome: confirmedIncome.toString(),
            aiAverageIncome: analysis.aiAverageIncome?.toString() ?? null,
          },
          ...meta,
        },
        tx,
      );
    });
    return this.view(app.code);
  }

  /** Everything the analyst's page shows. Never exposed to borrowers. */
  async view(code: string) {
    const app = await this.application(code);
    const [consent, documents, analysis] = await Promise.all([
      this.prisma.consent.findFirst({
        where: { borrowerId: app.borrowerId, type: 'CASHFLOW_ANALYSIS', revokedAt: null },
        orderBy: { grantedAt: 'desc' },
      }),
      this.prisma.cashflowDocument.findMany({
        where: { applicationId: app.id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.cashflowAnalysis.findFirst({
        where: { applicationId: app.id, status: { not: 'SUPERSEDED' } },
        orderBy: { createdAt: 'desc' },
        include: {
          flags: { orderBy: { severity: 'asc' } },
          transactions: { orderBy: [{ date: 'asc' }, { position: 'asc' }], take: 3000 },
        },
      }),
    ]);
    return {
      application: {
        code: app.code,
        borrowerName: app.borrower.fullName,
        productName: app.product.name,
        amount: app.amount,
        dsrBps: app.product.affordabilityBps,
        verifiedIncome: app.borrower.monthlyIncome,
        incomeVerifiedAt: app.borrower.incomeVerifiedAt?.toISOString() ?? null,
      },
      aiAvailable: this.ai.configured,
      consent: consent
        ? { grantedAt: consent.grantedAt.toISOString(), channel: consent.channel }
        : null,
      documents: documents.map((d) => ({
        id: d.id,
        kind: d.kind,
        fileName: d.fileName,
        size: d.size,
        status: d.status,
        extractor: d.extractor,
        holderName: d.holderName,
        payslip: d.payslip,
        error: d.error,
        createdAt: d.createdAt.toISOString(),
      })),
      analysis: analysis
        ? {
            id: analysis.id,
            status: analysis.status,
            modelVersion: analysis.modelVersion,
            extractors: analysis.extractors,
            error: analysis.error,
            createdAt: analysis.createdAt.toISOString(),
            report: analysis.report,
            confirmedIncome: analysis.confirmedIncome,
            reviewNote: analysis.reviewNote,
            reviewedAt: analysis.reviewedAt?.toISOString() ?? null,
            flags: analysis.flags.map((f) => ({
              id: f.id,
              code: f.code,
              severity: f.severity,
              message: f.message,
              evidence: f.evidence,
              outcome: f.outcome,
              outcomeNote: f.outcomeNote,
            })),
            transactions: analysis.transactions.map((t) => ({
              id: t.id,
              documentId: t.documentId,
              date: utcDateToIso(t.date),
              description: t.description,
              amount: t.amount,
              direction: t.direction,
              balance: t.balance,
              category: t.category,
              suggestedCategory: t.suggestedCategory,
              corrected: t.correctedAt != null,
            })),
          }
        : null,
    };
  }

  /** Pilot measures (PRD §6.15 assist mode): how far analysts' figures differ from the AI's. */
  async pilot() {
    const reviewed = await this.prisma.cashflowAnalysis.findMany({
      where: { status: 'REVIEWED', aiAverageIncome: { not: null }, confirmedIncome: { not: null } },
      select: { id: true, aiAverageIncome: true, confirmedIncome: true },
    });
    let within = 0;
    let totalDiffBps = 0;
    for (const r of reviewed) {
      const ai = Number(r.aiAverageIncome);
      const confirmed = Number(r.confirmedIncome);
      const diffBps =
        confirmed > 0 ? Math.round((Math.abs(ai - confirmed) / confirmed) * 10_000) : 10_000;
      totalDiffBps += diffBps;
      if (diffBps <= 1000) within++;
    }
    const [txns, corrected, flags] = await Promise.all([
      this.prisma.cashflowTransaction.count({ where: { analysis: { status: 'REVIEWED' } } }),
      this.prisma.cashflowTransaction.count({
        where: { analysis: { status: 'REVIEWED' }, correctedAt: { not: null } },
      }),
      this.prisma.cashflowFlag.groupBy({
        by: ['outcome'],
        where: { analysis: { status: 'REVIEWED' } },
        _count: true,
      }),
    ]);
    return {
      reviewed: reviewed.length,
      withinTenPercentBps: reviewed.length ? Math.round((within / reviewed.length) * 10_000) : 0,
      averageDifferenceBps: reviewed.length ? Math.round(totalDiffBps / reviewed.length) : 0,
      transactions: txns,
      correctionRateBps: txns ? Math.round((corrected / txns) * 10_000) : 0,
      flags: Object.fromEntries(flags.map((f) => [f.outcome, f._count])),
    };
  }

  // ── helpers ────────────────────────────────────────────────────────

  private async application(code: string) {
    const app = await this.prisma.application.findFirst({
      where: { code },
      include: { borrower: true, product: true },
    });
    if (!app) throw new NotFoundException(`No application ${code}`);
    return app;
  }

  /** Run the core analysis over the stored transactions. */
  private async report(
    analysisId: string,
    app: {
      submittedAt: Date;
      borrower: { fullName: string };
      product: { affordabilityBps: number; kind: string };
    },
    inputs?: {
      payslips: PayslipFacts[];
      holderNames: Array<{ documentId: string; name: string }>;
      duplicateDocumentIds: string[];
      aiReadDocumentIds: string[];
    },
  ): Promise<CashflowReport & { inputs: unknown }> {
    const rows = await this.prisma.cashflowTransaction.findMany({
      where: { analysisId },
      orderBy: [{ date: 'asc' }, { position: 'asc' }],
    });
    const payslips = (inputs?.payslips ?? []).map((p) => ({
      ...p,
      gross: p.gross == null ? null : BigInt(p.gross),
      deductions: p.deductions == null ? null : BigInt(p.deductions),
      net: p.net == null ? null : BigInt(p.net),
    }));
    const report = analyseCashflow({
      txns: rows.map((r) => ({
        id: r.id,
        date: utcDateToIso(r.date),
        description: r.description,
        amount: r.amount,
        direction: r.direction as 'IN' | 'OUT',
        balance: r.balance,
        category: r.category as CashflowCategory,
        documentId: r.documentId,
      })),
      payslips,
      holderNames: inputs?.holderNames ?? [],
      borrowerName: app.borrower.fullName,
      duplicateDocumentIds: inputs?.duplicateDocumentIds ?? [],
      aiReadDocumentIds: inputs?.aiReadDocumentIds ?? [],
      applicationDate: kigaliDate(app.submittedAt),
      settings: {
        dsrBps: app.product.affordabilityBps,
        minMonths: app.product.kind === 'SALARY' ? 3 : 6,
      },
    });
    return {
      ...report,
      inputs: {
        payslips: payslips.map((p) => ({
          ...p,
          gross: p.gross?.toString() ?? null,
          deductions: p.deductions?.toString() ?? null,
          net: p.net?.toString() ?? null,
        })),
        holderNames: inputs?.holderNames ?? [],
        duplicateDocumentIds: inputs?.duplicateDocumentIds ?? [],
        aiReadDocumentIds: inputs?.aiReadDocumentIds ?? [],
      },
    };
  }

  /** After a correction: add new flags, drop flags that no longer apply (keeping decided ones). */
  private async syncFlags(analysisId: string, report: CashflowReport) {
    const existing = await this.prisma.cashflowFlag.findMany({ where: { analysisId } });
    const codes = new Set(report.flags.map((f) => f.code));
    for (const f of existing) {
      if (!codes.has(f.code as never) && f.outcome === 'PENDING') {
        await this.prisma.cashflowFlag.delete({ where: { id: f.id } });
      }
    }
    const have = new Set(existing.map((f) => f.code));
    for (const f of report.flags) {
      if (have.has(f.code)) {
        await this.prisma.cashflowFlag.updateMany({
          where: { analysisId, code: f.code },
          data: { message: f.message, evidence: f.evidence },
        });
      } else {
        await this.prisma.cashflowFlag.create({
          data: {
            analysisId,
            code: f.code,
            severity: f.severity,
            message: f.message,
            evidence: f.evidence,
          },
        });
      }
    }
  }

  /** Read one document: CSV statements directly, PDFs and photos with Claude. */
  private async read(doc: {
    id: string;
    kind: CashflowDocKind;
    mimeType: string;
    storageKey: string;
  }): Promise<{
    status: 'READ' | 'UNREADABLE';
    extractor: string | null;
    txns: Array<Omit<CashflowTxn, 'id' | 'category'>>;
    payslip: PayslipFacts | null;
    holderName: string | null;
    error: string | null;
  }> {
    const none = { txns: [], payslip: null, holderName: null };
    const buffer = await readFile(path.join(this.env.UPLOAD_DIR, doc.storageKey));
    if (doc.mimeType === 'text/csv') {
      const rows = parseStatementCsv(parseCsv(buffer.toString('utf8')), doc.id);
      if (!rows) {
        return {
          ...none,
          status: 'UNREADABLE',
          extractor: 'csv-v1',
          error: 'This CSV layout is not supported yet; review it by hand',
        };
      }
      return { ...none, txns: rows, status: 'READ', extractor: 'csv-v1', error: null };
    }
    if (!this.ai.configured) {
      return {
        ...none,
        status: 'UNREADABLE',
        extractor: null,
        error:
          'Reading PDFs and photos needs AI assistance, which is off for this company. Review it by hand, or upload a CSV export.',
      };
    }
    const file = {
      mediaType: doc.mimeType as 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp',
      base64: buffer.toString('base64'),
    };
    try {
      if (doc.kind === 'PAYSLIP') {
        const p = await this.ai.structured({
          schema: payslipSchema,
          file,
          system:
            'You read Rwandan payslips for a lender. Copy figures exactly as printed. Never guess: use null for anything not shown. Amounts are whole Rwandan francs.',
          user: 'Read this payslip.',
          effort: 'low',
          maxTokens: 1500,
        });
        if (!p.readable) {
          return {
            ...none,
            status: 'UNREADABLE',
            extractor: this.ai.model,
            error: 'Not readable as a payslip',
          };
        }
        return {
          txns: [],
          holderName: p.employeeName,
          payslip: {
            documentId: doc.id,
            employer: p.employer,
            employeeName: p.employeeName,
            payPeriod: p.payPeriod,
            gross: digits(p.gross),
            deductions: digits(p.deductions),
            net: digits(p.net),
          },
          status: 'READ',
          extractor: this.ai.model,
          error: null,
        };
      }
      const s = await this.ai.structured({
        schema: statementSchema,
        file,
        system:
          'You read Rwandan bank and mobile money (MTN MoMo, Airtel Money) statements for a lender. List every transaction row exactly as printed, in order. Never invent rows or figures; use null where a balance is not shown. Amounts are whole Rwandan francs.',
        user: 'Extract the account holder and all transactions from this statement.',
        effort: 'low',
        maxTokens: 16000,
      });
      if (!s.readable) {
        return {
          ...none,
          status: 'UNREADABLE',
          extractor: this.ai.model,
          error: 'Not readable as a statement',
        };
      }
      const txns = s.transactions.flatMap((t) => {
        const date = parseStatementDate(t.date);
        const amount = digits(t.amount);
        if (!date || amount == null || amount === 0n) return [];
        return [
          {
            date,
            description: t.description,
            amount,
            direction: t.direction,
            balance: digits(t.balance),
            documentId: doc.id,
          },
        ];
      });
      return {
        txns,
        payslip: null,
        holderName: s.accountHolder,
        status: txns.length ? 'READ' : 'UNREADABLE',
        extractor: this.ai.model,
        error: txns.length ? null : 'No transactions found',
      };
    } catch (err) {
      const message =
        err instanceof AiUnavailableError ? err.message : 'The document could not be read';
      this.logger.warn(`Cash-flow read failed for document ${doc.id}: ${message}`);
      return {
        ...none,
        status: 'UNREADABLE',
        extractor: this.ai.model,
        error: `${message}. Review it by hand.`,
      };
    }
  }
}

/** bigints as digit strings, for a JSON column. */
function toJson(value: unknown): object {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

function looksLike(buf: Buffer, ext: string): boolean {
  if (ext === 'csv') return !buf.subarray(0, 512).includes(0);
  if (ext === 'pdf') return buf.subarray(0, 5).toString() === '%PDF-';
  if (ext === 'jpg') return buf[0] === 0xff && buf[1] === 0xd8;
  if (ext === 'png') return buf.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP';
}
