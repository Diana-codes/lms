import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { daysBetween, formatDate, instalmentRemaining, kigaliDate, utcDateToIso } from '@kora/core';
import { Pool } from 'pg';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { ENV, type Env } from '../config/env';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { AiClient, AiUnavailableError } from './ai.client';
import { checkSql, UnsafeSqlError } from './sql-guard';

const SummarySchema = z.object({
  summary: z.string().describe('Three or four plain sentences for a loan officer'),
  reasons: z
    .array(z.object({ kind: z.enum(['why', 'watch']), text: z.string().describe('Under 8 words') }))
    .describe('Two to four short reasons behind the summary'),
});

const ApproachSchema = z.object({
  bestTime: z.string().describe('When and how to reach the borrower, from the contact history'),
  offer: z.string().describe('What to propose, in one sentence'),
  assessment: z
    .string()
    .describe('How likely recovery looks and why, in one sentence. No invented percentages.'),
  smsKinyarwanda: z
    .string()
    .describe('A short, respectful reminder SMS in Kinyarwanda, under 300 characters'),
});

const SqlSchema = z.object({
  sql: z.string().describe('One PostgreSQL SELECT over the reporting views'),
  title: z.string().describe('What the query measures, in a few words'),
});

const AnswerSchema = z.object({
  headline: z.string().describe('The answer in under 8 words'),
  body: z.string().describe('Two or three sentences explaining the result'),
  bars: z
    .array(z.object({ label: z.string(), value: z.number() }))
    .describe('Up to 6 values to chart; empty if a chart does not help'),
  unit: z.string().describe('Unit for the bar values, e.g. "%", "M", "loans"; empty if none'),
});

/** What the reporting views hold, for the model writing SQL. */
const REPORTING_SCHEMA = `PostgreSQL views (schema "reporting"; refer to them unqualified). Money columns end in _rwf and are whole Rwandan francs.
products(code, name, kind, annual_rate_pct, min_term_months, max_term_months, is_active)
officers(officer_id, officer, role, branch)
borrowers(borrower_code, type, gender, district, sector, kyc_status, risk_level, customer_since, monthly_income_rwf, business_sector, officer_id)
loans(loan_code, borrower_code, product, product_kind, status ['PENDING_DISBURSEMENT','ACTIVE','REPAID','WRITTEN_OFF'], principal_rwf, annual_rate_pct, term_months, instalment_rwf, disbursed_on, maturity_date, closed_on, officer_id, district, outstanding_principal_rwf, days_past_due)
instalments(loan_code, number, due_date, principal_due_rwf, interest_due_rwf, principal_paid_rwf, interest_paid_rwf, status ['PENDING','PARTIAL','PAID'], paid_on)
payments(loan_code, amount_rwf, channel ['MTN_MOMO','AIRTEL_MONEY','BANK_TRANSFER','CASH'], status, received_on)
applications(application_code, borrower_code, product, amount_rwf, term_months, stage ['NEW','UNDER_REVIEW','CREDIT_CHECK','APPROVED','DISBURSED','DECLINED','WITHDRAWN'], channel, submitted_on, decided_on, officer_id, district)
collection_cases(loan_code, status, next_action, opened_on, closed_on, officer_id)
promises_to_pay(loan_code, amount_rwf, promised_for, status ['OPEN','KEPT','BROKEN','CANCELLED'])
Definitions: PAR 30 = outstanding_principal_rwf of ACTIVE loans with days_past_due > 30, divided by all ACTIVE outstanding_principal_rwf. Collection rate = paid / due for instalments due in a period. Today in Kigali is CURRENT_DATE.`;

const ROW_LIMIT = 200;
const NOTE_FRESH_MS = { summary: 24 * 3_600_000, approach: 12 * 3_600_000 };

/**
 * Claude-written text for staff: borrower summaries, collections advice and
 * SMS drafts, and answers to "Ask your data". All of it is advice, shown in
 * the purple AI style, stored with its inputs and model, and never acts on
 * its own. Personal identifiers (names, phones, ID numbers) are not sent.
 */
@Injectable()
export class AiService implements OnModuleDestroy {
  private readonly reporting: Pool | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClient,
    private readonly audit: AuditService,
    private readonly providers: ProvidersService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.reporting = env.REPORTING_DATABASE_URL
      ? new Pool({ connectionString: env.REPORTING_DATABASE_URL, max: 3 })
      : null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.reporting?.end();
  }

  status() {
    return {
      configured: this.ai.configured,
      model: this.ai.configured ? this.ai.model : null,
      askYourData: this.ai.configured && this.reporting != null,
    };
  }

  private unavailable(err: unknown): never {
    throw new HttpException(
      {
        message: err instanceof Error ? err.message : 'The AI service is unavailable',
        configured: this.ai.configured,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /** A short written profile of a borrower, refreshed at most daily unless forced. */
  async borrowerSummary(code: string, user: AuthUser, force: boolean, meta: RequestMeta) {
    const b = await this.prisma.borrower.findFirst({
      where: { code },
      include: {
        business: true,
        loans: { include: { product: true, instalments: { where: { supersededAt: null } } } },
        creditScores: { orderBy: { createdAt: 'desc' }, take: 2 },
        kycDocuments: true,
        momoInflows: { orderBy: { month: 'asc' } },
        consents: { where: { type: 'MOMO_HISTORY', revokedAt: null } },
      },
    });
    if (!b) throw new NotFoundException(`No borrower ${code}`);
    const cached = await this.prisma.aiNote.findFirst({
      where: { kind: 'borrower_summary', borrowerId: b.id },
      orderBy: { createdAt: 'desc' },
    });
    if (cached && !force && Date.now() - cached.createdAt.getTime() < NOTE_FRESH_MS.summary)
      return this.noteView(cached);

    const today = kigaliDate();
    const instalments = b.loans.flatMap((l) => l.instalments);
    const paid = instalments.filter((i) => i.status === 'PAID' && i.paidAt);
    // Facts only: no name, phone, ID number or officer notes.
    const facts = {
      borrowerType: b.type,
      business: b.business
        ? {
            sector: b.business.sector,
            avgMonthlyRevenueRwf: b.business.avgMonthlyRevenue?.toString() ?? null,
          }
        : null,
      verifiedMonthlyIncomeRwf: b.monthlyIncome?.toString() ?? null,
      monthsAsCustomer: Math.floor(daysBetween(utcDateToIso(b.customerSince), today) / 30),
      kyc: b.kycDocuments.map((d) => ({
        type: d.type,
        status: d.status,
        expiresOn: d.expiresOn ? utcDateToIso(d.expiresOn) : null,
      })),
      loans: b.loans.map((l) => ({
        product: l.product.name,
        principalRwf: l.principal.toString(),
        status: l.status,
        termMonths: l.termMonths,
        instalmentRwf: l.instalmentAmount.toString(),
        leftToPayRwf: l.instalments.reduce((s, i) => s + instalmentRemaining(i), 0n).toString(),
      })),
      instalments: {
        paid: paid.length,
        paidLate: paid.filter((i) => kigaliDate(i.paidAt!) > utcDateToIso(i.dueDate)).length,
        paidEarly: paid.filter((i) => kigaliDate(i.paidAt!) < utcDateToIso(i.dueDate)).length,
        overdueNow: instalments.filter(
          (i) => i.status !== 'PAID' && utcDateToIso(i.dueDate) < today,
        ).length,
      },
      latestScore: b.creditScores[0]
        ? {
            value: b.creditScores[0].value,
            previous: b.creditScores[1]?.value ?? null,
            model: b.creditScores[0].modelVersion,
          }
        : null,
      momoInflowsRwf: b.consents.length
        ? b.momoInflows.map((m) => ({
            month: utcDateToIso(m.month).slice(0, 7),
            inflow: m.inflow.toString(),
          }))
        : 'not shared',
      preApprovedLimitRwf: b.preApprovedLimit?.toString() ?? null,
      affordabilityLimit: '35% of verified monthly income',
      today,
    };
    let out: z.infer<typeof SummarySchema>;
    try {
      out = await this.ai.structured({
        schema: SummarySchema,
        effort: 'low',
        system:
          'You write short credit profiles for loan officers at Kora Lend, a lender in Rwanda. Use only the facts given. Amounts are Rwandan francs: write them as "RWF 1.6M" or "RWF 380,000". Be plain and specific. Do not recommend approving or declining; officers decide. Refer to the borrower as "the borrower" or "they".',
        user: `Write the profile from these facts:\n${JSON.stringify(facts)}`,
      });
    } catch (err) {
      if (err instanceof AiUnavailableError) this.unavailable(err);
      throw err;
    }
    const note = await this.prisma.aiNote.create({
      data: {
        kind: 'borrower_summary',
        borrowerId: b.id,
        content: out as Prisma.InputJsonValue,
        inputs: facts as unknown as Prisma.InputJsonValue,
        model: this.ai.model,
      },
    });
    await this.audit.record({
      action: 'ai.borrower_summary',
      actorId: user.id,
      entityType: 'Borrower',
      entityId: code,
      metadata: { noteId: note.id, model: this.ai.model },
      ...meta,
    });
    return this.noteView(note);
  }

  private noteView(note: {
    id: string;
    content: Prisma.JsonValue;
    model: string;
    createdAt: Date;
  }) {
    const c = note.content as z.infer<typeof SummarySchema>;
    return {
      text: c.summary,
      reasons: c.reasons,
      updatedOn: kigaliDate(note.createdAt),
      modelVersion: note.model,
    };
  }

  /** How to approach an overdue account, with a Kinyarwanda SMS draft for review. */
  async collectionsApproach(loanCode: string, user: AuthUser) {
    if (!this.ai.configured) return { approach: null, reason: 'not_configured' as const };
    const loan = await this.prisma.loan.findFirst({
      where: { code: loanCode },
      include: {
        borrower: { select: { id: true, type: true, fullName: true } },
        instalments: { where: { supersededAt: null }, orderBy: { number: 'asc' } },
        contactLogs: { orderBy: { occurredAt: 'desc' }, take: 15 },
        promises: { orderBy: { createdAt: 'desc' }, take: 5 },
        payments: { where: { status: 'SUCCESSFUL' }, orderBy: { confirmedAt: 'desc' }, take: 12 },
      },
    });
    if (!loan) throw new NotFoundException(`No loan ${loanCode}`);
    const lastContact = loan.contactLogs[0]?.occurredAt.getTime() ?? 0;
    const cached = await this.prisma.aiNote.findFirst({
      where: { kind: 'collections_approach', loanId: loan.id },
      orderBy: { createdAt: 'desc' },
    });
    if (
      cached &&
      Date.now() - cached.createdAt.getTime() < NOTE_FRESH_MS.approach &&
      cached.createdAt.getTime() > lastContact
    ) {
      return {
        approach: {
          ...(cached.content as z.infer<typeof ApproachSchema>),
          odds: (cached.content as z.infer<typeof ApproachSchema>).assessment,
          model: cached.model,
        },
        reason: null,
      };
    }

    const today = kigaliDate();
    const payCode = await this.providers.momoPayCode();
    const unpaid = loan.instalments.filter((i) => i.status !== 'PAID');
    const overdue = unpaid.filter((i) => utcDateToIso(i.dueDate) < today);
    const firstName =
      loan.borrower.type === 'BUSINESS'
        ? loan.borrower.fullName
        : loan.borrower.fullName.split(' ')[0]!;
    const kigaliHour = (d: Date) => (d.getUTCHours() + 2) % 24;
    const facts = {
      daysPastDue: overdue[0] ? daysBetween(utcDateToIso(overdue[0].dueDate), today) : 0,
      overdueRwf: overdue.reduce((s, i) => s + instalmentRemaining(i), 0n).toString(),
      outstandingRwf: unpaid.reduce((s, i) => s + instalmentRemaining(i), 0n).toString(),
      instalmentRwf: loan.instalmentAmount.toString(),
      instalmentsLeft: unpaid.length,
      contactHistory: loan.contactLogs.map((c) => ({
        on: kigaliDate(c.occurredAt),
        hourKigali: kigaliHour(c.occurredAt),
        weekday: c.occurredAt.getUTCDay(),
        channel: c.channel,
        outcome: c.outcome,
        note: c.summary,
      })),
      promises: loan.promises.map((p) => ({
        amountRwf: p.amount.toString(),
        for: utcDateToIso(p.promisedFor),
        status: p.status,
      })),
      recentPaymentTimesKigali: loan.payments
        .map((p) =>
          p.confirmedAt ? { on: kigaliDate(p.confirmedAt), hour: kigaliHour(p.confirmedAt) } : null,
        )
        .filter(Boolean),
      borrowerType: loan.borrower.type,
      // The first name is used only to greet the borrower in the SMS draft.
      greetingName: firstName,
      loanCode: loan.code,
      payInstruction: payCode ? `MoMo Pay ${payCode}` : 'MoMo or at a branch',
      today,
    };
    let out: z.infer<typeof ApproachSchema>;
    try {
      out = await this.ai.structured({
        schema: ApproachSchema,
        effort: 'low',
        system:
          'You advise a collections agent at Kora Lend, a lender in Rwanda, on one overdue account. Base every point on the contact history and payments given; if there is little history, say so. Suggest a respectful, practical approach: a time to call, and an offer such as a short payment plan or a reminder. Never suggest threats, shaming, contacting family or employers, or anything a regulator would object to. Write the SMS in natural, polite Kinyarwanda, greeting the borrower by the name given, stating the overdue amount in RWF and the loan number, and how to pay. A native speaker will check the SMS before it is sent.',
        user: `Account facts:\n${JSON.stringify(facts)}`,
      });
    } catch (err) {
      if (err instanceof AiUnavailableError)
        return { approach: null, reason: 'unavailable' as const };
      throw err;
    }
    const { greetingName: _n, ...storedFacts } = facts;
    await this.prisma.aiNote.create({
      data: {
        kind: 'collections_approach',
        loanId: loan.id,
        borrowerId: loan.borrower.id,
        content: out as Prisma.InputJsonValue,
        inputs: storedFacts as unknown as Prisma.InputJsonValue,
        model: this.ai.model,
      },
    });
    await this.audit.record({
      action: 'ai.collections_approach',
      actorId: user.id,
      entityType: 'Loan',
      entityId: loan.code,
      metadata: { model: this.ai.model },
    });
    return { approach: { ...out, odds: out.assessment, model: this.ai.model }, reason: null };
  }

  /**
   * "Ask your data": the question becomes SQL over the reporting views, the
   * SQL runs on a read-only login, and the rows become a short answer. The
   * query is always returned so staff can see exactly what was counted.
   */
  async ask(question: string, user: AuthUser, meta: RequestMeta) {
    if (!this.ai.configured)
      this.unavailable(new AiUnavailableError('The AI service is not configured'));
    if (!this.reporting)
      this.unavailable(new AiUnavailableError('The reporting database login is not configured'));
    const record = (data: Omit<Prisma.DataQuestionUncheckedCreateInput, 'userId' | 'question'>) =>
      this.prisma.dataQuestion.create({
        data: { userId: user.id, question, model: this.ai.model, ...data },
      });

    let sql = '';
    let rows: Record<string, unknown>[] = [];
    let lastError: string | null = null;
    let title = '';
    try {
      // One attempt, plus one repair if the database rejects the query.
      for (let attempt = 0; attempt < 2; attempt++) {
        const drafted = await this.ai.structured({
          schema: SqlSchema,
          effort: 'medium',
          system: `You write PostgreSQL for a lender's reporting database. Answer with one SELECT (or WITH ... SELECT) over these views only:\n${REPORTING_SCHEMA}\nAggregate where you can and return at most ${ROW_LIMIT} rows. Round percentages to one decimal.`,
          user: lastError
            ? `Question: ${question}\nYour previous query:\n${sql}\nfailed with: ${lastError}\nWrite a corrected query.`
            : `Question: ${question}`,
        });
        title = drafted.title;
        try {
          sql = checkSql(drafted.sql);
        } catch (err) {
          if (err instanceof UnsafeSqlError) {
            sql = drafted.sql;
            lastError = err.message;
            continue;
          }
          throw err;
        }
        try {
          rows = await this.run(sql);
          lastError = null;
          break;
        } catch (err) {
          lastError = (err as Error).message.slice(0, 300);
        }
      }
    } catch (err) {
      if (err instanceof AiUnavailableError) this.unavailable(err);
      throw err;
    }
    if (lastError) {
      await record({ sql, error: lastError });
      return {
        ok: false as const,
        question,
        sql,
        error: 'I could not turn that question into a working query. Try asking it another way.',
      };
    }

    let answer: z.infer<typeof AnswerSchema>;
    try {
      answer = await this.ai.structured({
        schema: AnswerSchema,
        effort: 'low',
        system:
          'You explain query results to managers at a lender in Rwanda. Use only the rows given; if they do not answer the question, say so. Reply in the language of the question (English, Kinyarwanda or French). Amounts are Rwandan francs: write "RWF 4.2M".',
        user: `Question: ${question}\nQuery (${title}):\n${sql}\nRows (${rows.length}${rows.length === ROW_LIMIT ? ', truncated' : ''}):\n${JSON.stringify(rows.slice(0, 60))}`,
      });
    } catch (err) {
      if (err instanceof AiUnavailableError) this.unavailable(err);
      throw err;
    }
    const saved = await record({ sql, rowCount: rows.length });
    await this.audit.record({
      action: 'ai.ask',
      actorId: user.id,
      metadata: { questionId: saved.id, rows: rows.length },
      ...meta,
    });
    return {
      ok: true as const,
      question,
      sql,
      rowCount: rows.length,
      ...answer,
      source: `${title} · ${rows.length} ${rows.length === 1 ? 'row' : 'rows'} · as of ${formatDate(kigaliDate())}`,
      model: this.ai.model,
    };
  }

  /**
   * Run a checked query on the read-only login, inside a read-only transaction.
   * The reporting views only show the company registered for this exact
   * database connection; the registration is written through the company
   * login, whose policies only allow its own company.
   */
  async run(sql: string): Promise<Record<string, unknown>[]> {
    const client = await this.reporting!.connect();
    let pid: number | null = null;
    try {
      pid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      await this.prisma.$executeRaw`
        INSERT INTO reporting_ctx.session_company (pid, company_id) VALUES (${pid}, current_company_id())
        ON CONFLICT (pid) DO UPDATE SET company_id = current_company_id(), set_at = now()`;
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = '5s'`);
      await client.query('SET LOCAL search_path = reporting');
      const result = await client.query(`SELECT * FROM (${sql}) AS answer LIMIT ${ROW_LIMIT}`);
      await client.query('ROLLBACK');
      return result.rows as Record<string, unknown>[];
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      if (pid != null) {
        await this.prisma
          .$executeRaw`DELETE FROM reporting_ctx.session_company WHERE pid = ${pid}`.catch(
          () => undefined,
        );
      }
      client.release();
    }
  }

  /** Scores by gender and district, so managers can watch for unfair patterns. */
  async fairness() {
    const rows = await this.prisma.$queryRaw<
      Array<{
        dimension: string;
        grp: string;
        borrowers: bigint;
        avg_score: number;
        approve_share: number;
      }>
    >`
      WITH latest AS (
        SELECT DISTINCT ON (s."borrowerId") s."borrowerId", s."value", s."recommendation"
        FROM "CreditScore" s WHERE s."modelVersion" <> 'seed-sample-v0'
        ORDER BY s."borrowerId", s."createdAt" DESC
      )
      SELECT 'gender' AS dimension, b."gender"::text AS grp, COUNT(*)::bigint AS borrowers, ROUND(AVG(l."value"))::int AS avg_score,
             ROUND(100.0 * AVG(CASE WHEN l."recommendation" IN ('APPROVE','AUTO_APPROVE_ELIGIBLE') THEN 1 ELSE 0 END), 1)::float AS approve_share
      FROM latest l JOIN "Borrower" b ON b."id" = l."borrowerId" WHERE b."type" = 'INDIVIDUAL' GROUP BY 2
      UNION ALL
      SELECT 'district', COALESCE(b."district", 'Unknown'), COUNT(*), ROUND(AVG(l."value"))::int,
             ROUND(100.0 * AVG(CASE WHEN l."recommendation" IN ('APPROVE','AUTO_APPROVE_ELIGIBLE') THEN 1 ELSE 0 END), 1)::float
      FROM latest l JOIN "Borrower" b ON b."id" = l."borrowerId" GROUP BY 2
      ORDER BY 1, 3 DESC`;
    return rows.map((r) => ({
      dimension: r.dimension,
      group: r.grp,
      borrowers: Number(r.borrowers),
      averageScore: r.avg_score,
      approveShare: r.approve_share,
    }));
  }
}
