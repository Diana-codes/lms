import { Injectable } from '@nestjs/common';
import {
  addDays,
  addMonths,
  daysBetween,
  initials,
  kigaliDate,
  ratioBps,
  shortStaffName,
  utcDateToIso,
  type IsoDate,
} from '@kora/core';
import { ACCOUNTS } from '../ledger/accounts';
import { PrismaService } from '../prisma/prisma.service';

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

/**
 * Reports, rebuilt from the ledger and the repayment schedules for each
 * month end, so history reflects what was true then:
 *  - outstanding principal: ledger entries on 1100 dated on or before the month end;
 *  - days past due: the oldest instalment due before the month end that had
 *    not been paid in full by then.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

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
        SELECT l."officerId", SUM(i."principalDue" + i."interestDue")::bigint AS due,
               SUM(i."principalPaid" + i."interestPaid")::bigint AS paid
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
    const r = await this.report(period);
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
}
