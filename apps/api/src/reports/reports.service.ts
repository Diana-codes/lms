import { Injectable } from '@nestjs/common';
import {
  addDays,
  addMonths,
  CREDIT_CLASS_LABELS,
  type CreditClass,
  type CreditClassProfile,
  classifyPortfolio,
  daysBetween,
  daysPastDue,
  initials,
  isoToUtcDate,
  kigaliDate,
  PROVISION_BPS,
  ratioBps,
  shortStaffName,
  utcDateToIso,
  type IsoDate,
} from '@kora/core';
import { ACCOUNTS } from '../ledger/accounts';
import { LedgerService } from '../ledger/ledger.service';
import { LoanSecurityService } from '../loans/loan-security.service';
import { PrismaService } from '../prisma/prisma.service';
import { requireCompanyId } from '../tenancy/company-context';

export type Period = 'Q' | 'YTD' | '12M';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface LoanMonth {
  month: Date;
  loanId: string;
  productId: string;
  officerId: string | null;
  outstanding: bigint;
  oldest: Date | null;
}

/** The last day of each month in the period; the current month ends today. */
export function monthEnds(period: Period, today: IsoDate): IsoDate[] {
  const thisMonth = `${today.slice(0, 7)}-01`;
  const count = period === 'Q' ? 3 : period === '12M' ? 12 : Number(today.slice(5, 7));
  return Array.from({ length: count }, (_, i) => {
    const start = addMonths(thisMonth, i - count + 1);
    const end = addDays(addMonths(start, 1), -1);
    return end > today ? today : end;
  });
}

/** Shape passed to {@link reportToCsv} (matches {@link ReportsService.report}). */
export interface ReportCsvInput {
  period: Period;
  asOf: string;
  series: Array<{
    month: string;
    outstanding: bigint;
    activeLoans: number;
    averageLoan: bigint;
    par30Bps: number;
    yieldBps: number;
  }>;
  products: Array<{ name: string; outstanding: bigint; shareBps: number }>;
  officers: Array<{
    name: string;
    activeLoans: number;
    portfolio: bigint;
    par30Bps: number;
    collectionRateBps: number | null;
  }>;
}

/** Spreadsheet-safe CSV for the portfolio report. */
export function reportToCsv(r: ReportCsvInput): string {
  const esc = (v: string | number | bigint | null) => {
    const s = v == null ? '' : String(v);
    // Neutralise spreadsheet formulas in text cells.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d+$/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const pct = (bps: number | null) => (bps == null ? '' : (bps / 100).toFixed(2));
  const lines = [
    `Kora Lend report,${esc(r.period)},as of ${r.asOf}`,
    '',
    'Month end,Outstanding principal (RWF),Active loans,Average loan (RWF),PAR 30 (%),Yield (% a year)',
    ...r.series.map((m) =>
      [m.month, m.outstanding, m.activeLoans, m.averageLoan, pct(m.par30Bps), pct(m.yieldBps)]
        .map(esc)
        .join(','),
    ),
    '',
    'Product,Outstanding principal (RWF),Share (%)',
    ...r.products.map((p) => [p.name, p.outstanding, pct(p.shareBps)].map(esc).join(',')),
    '',
    'Loan officer,Active loans,Portfolio (RWF),PAR 30 (%),Collection rate (%)',
    ...r.officers.map((o) =>
      [o.name, o.activeLoans, o.portfolio, pct(o.par30Bps), pct(o.collectionRateBps)]
        .map(esc)
        .join(','),
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Reports, rebuilt from the ledger and the repayment schedules for each
 * month end, so history reflects what was true then:
 *  - outstanding principal: ledger entries on 1100 dated on or before the month end;
 *  - days past due: the oldest instalment due before the month end that had
 *    not been paid in full by then.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly security: LoanSecurityService,
  ) {}

  /**
   * BNR Regulation 59/2023 Art. 34 portfolio classification: today's live
   * figures (or the stored snapshot for a past day), with the allowance
   * held on the ledger.
   */
  async classification(asOf?: IsoDate) {
    const today = kigaliDate();
    const day = asOf && asOf <= today ? asOf : today;
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: requireCompanyId() },
      select: { creditClassProfile: true, name: true },
    });
    const profile = company.creditClassProfile as CreditClassProfile;

    if (day < today) {
      const rows = await this.prisma.loanClassificationDaily.findMany({
        where: { day: isoToUtcDate(day) },
        orderBy: { creditClass: 'asc' },
      });
      if (rows.length) {
        const outstanding = rows.reduce((s, r) => s + r.outstandingPrincipal, 0n);
        const required = rows.reduce((s, r) => s + r.requiredProvision, 0n);
        const npl = rows
          .filter((r) => r.creditClass === 'SUBSTANDARD' || r.creditClass === 'DOUBTFUL' || r.creditClass === 'LOSS')
          .reduce((s, r) => s + r.outstandingPrincipal, 0n);
        return {
          asOf: day,
          source: 'snapshot' as const,
          profile,
          company: company.name,
          loans: rows.reduce((s, r) => s + r.loanCount, 0),
          outstandingPrincipal: outstanding,
          requiredProvision: required,
          allowanceHeld: await this.ledger.loanLossAllowance(),
          nonPerformingPrincipal: npl,
          nplBps: ratioBps(npl, outstanding),
          buckets: rows.map((r) => ({
            creditClass: r.creditClass,
            label: CREDIT_CLASS_LABELS[r.creditClass as CreditClass],
            loanCount: r.loanCount,
            outstandingPrincipal: r.outstandingPrincipal,
            requiredProvision: r.requiredProvision,
            provisionBps: PROVISION_BPS[r.creditClass as CreditClass],
            nonPerforming:
              r.creditClass === 'SUBSTANDARD' ||
              r.creditClass === 'DOUBTFUL' ||
              r.creditClass === 'LOSS',
          })),
        };
      }
    }

    const loans = await this.prisma.loan.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        code: true,
        creditClass: true,
        instalments: {
          where: { supersededAt: null, status: { not: 'PAID' } },
          orderBy: { dueDate: 'asc' },
          take: 1,
          select: { dueDate: true },
        },
      },
    });
    const withBal = [];
    for (const loan of loans) {
      const outstandingPrincipal = await this.ledger.outstandingPrincipal(loan.id);
      if (outstandingPrincipal <= 0n) continue;
      const dpd = daysPastDue(
        loan.instalments[0] ? utcDateToIso(loan.instalments[0].dueDate) : null,
        day,
      );
      const admissibleCollateral = await this.security.admissibleForLoan(loan.id);
      withBal.push({
        outstandingPrincipal,
        dpd,
        admissibleCollateral,
        code: loan.code,
        creditClass: loan.creditClass,
      });
    }
    const portfolio = classifyPortfolio(withBal, profile);
    const allowanceHeld = await this.ledger.loanLossAllowance();
    return {
      asOf: day,
      source: 'live' as const,
      profile,
      company: company.name,
      loans: portfolio.loans,
      outstandingPrincipal: portfolio.outstandingPrincipal,
      requiredProvision: portfolio.requiredProvision,
      allowanceHeld,
      nonPerformingPrincipal: portfolio.nonPerformingPrincipal,
      nplBps: portfolio.nplBps,
      buckets: portfolio.buckets,
      shortfall: portfolio.requiredProvision - allowanceHeld,
    };
  }

  async report(period: Period) {
    const today = kigaliDate();
    const ends = monthEnds(period, today);
    const first = ends[0]!;
    const periodStart = `${first.slice(0, 7)}-01`;

    const rows = await this.prisma.$queryRaw<LoanMonth[]>`
      WITH months AS (SELECT unnest(${ends}::date[]) AS me)
      SELECT m.me AS month, l."id" AS "loanId", l."productId", l."officerId",
             bal.o::bigint AS outstanding, due.oldest
      FROM months m
      CROSS JOIN "Loan" l
      JOIN LATERAL (
        SELECT COALESCE(SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE -e."amount" END), 0) AS o
        FROM "LedgerEntry" e
        JOIN "LedgerAccount" a ON a."id" = e."accountId"
        JOIN "LedgerTransaction" t ON t."id" = e."transactionId"
        WHERE e."loanId" = l."id" AND a."code" = ${ACCOUNTS.LOANS_PRINCIPAL.code} AND t."effectiveOn" <= m.me
      ) bal ON bal.o > 0
      LEFT JOIN LATERAL (
        SELECT MIN(i."dueDate") AS oldest
        FROM "ScheduleInstalment" i
        WHERE i."loanId" = l."id" AND i."supersededAt" IS NULL AND i."dueDate" < m.me
          AND (i."paidAt" IS NULL OR (i."paidAt" + interval '2 hours')::date > m.me)
      ) due ON TRUE
      WHERE l."status" <> 'PENDING_DISBURSEMENT'`;

    const [interest, products, officers, dueInPeriod] = await Promise.all([
      this.prisma.$queryRaw<Array<{ month: Date; amount: bigint }>>`
        SELECT date_trunc('month', t."effectiveOn")::date AS month, SUM(e."amount")::bigint AS amount
        FROM "LedgerEntry" e
        JOIN "LedgerAccount" a ON a."id" = e."accountId"
        JOIN "LedgerTransaction" t ON t."id" = e."transactionId"
        WHERE a."code" = ${ACCOUNTS.INTEREST_INCOME.code} AND e."direction" = 'CREDIT'
          AND t."effectiveOn" >= ${periodStart}::date
        GROUP BY 1`,
      this.prisma.product.findMany({ select: { id: true, name: true, shortName: true } }),
      this.prisma.user.findMany({
        where: { role: 'LOAN_OFFICER' },
        select: { id: true, firstName: true, lastName: true, isActive: true },
      }),
      // Collection rate per officer: of what fell due in the period, how much has been paid.
      this.prisma.$queryRaw<Array<{ officerId: string | null; due: bigint; paid: bigint }>>`
        SELECT l."officerId", SUM(i."principalDue" + i."interestDue" + i."feeDue")::bigint AS due,
               SUM(i."principalPaid" + i."interestPaid" + i."feePaid")::bigint AS paid
        FROM "ScheduleInstalment" i JOIN "Loan" l ON l."id" = i."loanId"
        WHERE i."supersededAt" IS NULL AND i."dueDate" >= ${periodStart}::date AND i."dueDate" <= ${today}::date
        GROUP BY l."officerId"`,
    ]);

    // Month by month.
    const byMonth = new Map<IsoDate, LoanMonth[]>();
    for (const r of rows) {
      const key = utcDateToIso(r.month);
      byMonth.set(key, [...(byMonth.get(key) ?? []), r]);
    }
    const interestBy = new Map(interest.map((i) => [utcDateToIso(i.month).slice(0, 7), i.amount]));
    const series = ends.map((end) => {
      const loans = byMonth.get(end) ?? [];
      let outstanding = 0n;
      let atRisk = 0n;
      for (const l of loans) {
        outstanding += l.outstanding;
        if (l.oldest && daysBetween(utcDateToIso(l.oldest), end) > 30) atRisk += l.outstanding;
      }
      const monthInterest = interestBy.get(end.slice(0, 7)) ?? 0n;
      // Yield for a month: interest earned, scaled to a year, over the balance. Part months are scaled up.
      const daysIn = Number(end.slice(8, 10));
      const annualised = (monthInterest * 365n) / BigInt(daysIn);
      return {
        month: end,
        label: MONTHS[Number(end.slice(5, 7)) - 1]!,
        outstanding,
        activeLoans: loans.length,
        averageLoan: loans.length ? outstanding / BigInt(loans.length) : 0n,
        par30Bps: ratioBps(atRisk, outstanding),
        yieldBps: ratioBps(annualised, outstanding),
      };
    });

    // Today's split by product and officer.
    const latest = byMonth.get(ends[ends.length - 1]!) ?? [];
    const total = latest.reduce((s, l) => s + l.outstanding, 0n);
    const byProduct = new Map<string, bigint>();
    for (const l of latest)
      byProduct.set(l.productId, (byProduct.get(l.productId) ?? 0n) + l.outstanding);
    const mix = products
      .map((p) => ({
        name: p.name,
        outstanding: byProduct.get(p.id) ?? 0n,
        shareBps: ratioBps(byProduct.get(p.id) ?? 0n, total),
      }))
      .filter((p) => p.outstanding > 0n)
      .sort((a, b) => (b.outstanding > a.outstanding ? 1 : -1));

    const dueBy = new Map(dueInPeriod.map((d) => [d.officerId, d]));
    const officerRows = officers
      .map((o) => {
        const mine = latest.filter((l) => l.officerId === o.id);
        const port = mine.reduce((s, l) => s + l.outstanding, 0n);
        const risk = mine
          .filter((l) => l.oldest && daysBetween(utcDateToIso(l.oldest), today) > 30)
          .reduce((s, l) => s + l.outstanding, 0n);
        const d = dueBy.get(o.id);
        return {
          name: shortStaffName(o.firstName, o.lastName),
          initials: initials(`${o.firstName} ${o.lastName}`),
          activeLoans: mine.length,
          portfolio: port,
          par30Bps: ratioBps(risk, port),
          collectionRateBps: d && d.due > 0n ? ratioBps(d.paid, d.due) : null,
        };
      })
      .filter((o) => o.activeLoans > 0)
      .sort((a, b) => b.activeLoans - a.activeLoans);

    return { period, asOf: today, from: periodStart, series, products: mix, officers: officerRows };
  }

  /** The same figures as CSV, for spreadsheets. */
  async csv(period: Period): Promise<string> {
    return reportToCsv(await this.report(period));
  }
}
