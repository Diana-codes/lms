import { Injectable } from '@nestjs/common';
import {
  addDays,
  addMonths,
  APPLICATION_STAGE_LABELS,
  collectionRateBps,
  dpdBucket,
  initials,
  instalmentRemaining,
  isoToUtcDate,
  kigaliDate,
  par30Bps,
  ratioBps,
  utcDateToIso,
  type DpdBucket,
  type IsoDate,
} from '@kora/core';
import type { AuthUser } from '../auth/auth.types';
import { escapeLike, likePattern } from '../common/http';
import { Prisma } from '../generated/prisma/client';
import { ACCOUNTS } from '../ledger/accounts';
import { PrismaService } from '../prisma/prisma.service';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monthStart = (date: IsoDate): IsoDate => `${date.slice(0, 7)}-01`;

export type RecentStatus =
  'Approved' | 'Disbursed' | 'In review' | 'Docs needed' | 'Declined' | 'Withdrawn' | 'New';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Everything on the Overview screen. Loan officers see their own book;
   * managers, administrators and collections see the whole portfolio.
   */
  async overview(user: AuthUser) {
    const today = kigaliDate();
    const scoped = user.role === 'LOAN_OFFICER';
    const mine = scoped ? Prisma.sql`AND l."officerId" = ${user.id}::uuid` : Prisma.empty;
    const thisMonth = monthStart(today);
    const lastMonth = addMonths(thisMonth, -1);
    const firstMonth = addMonths(thisMonth, -11);
    const weekEnd = addDays(today, 6);
    const principalCode = ACCOUNTS.LOANS_PRINCIPAL.code;

    const [risk, balances, disbursed, collected, dueNow, recent, dueSoon, dueSoonCount] =
      await Promise.all([
        // Per active loan: outstanding principal (ledger) and days past due (schedule).
        this.prisma.$queryRaw<Array<{ outstanding: bigint; dpd: number }>>`
          SELECT COALESCE(bal.outstanding, 0)::bigint AS outstanding,
                 GREATEST(0, (${today}::date - due.oldest))::int AS dpd
          FROM "Loan" l
          LEFT JOIN LATERAL (
            SELECT SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE -e."amount" END) AS outstanding
            FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a."id" = e."accountId"
            WHERE e."loanId" = l."id" AND a."code" = ${principalCode}
          ) bal ON TRUE
          LEFT JOIN LATERAL (
            SELECT MIN(i."dueDate") AS oldest FROM "ScheduleInstalment" i
            WHERE i."loanId" = l."id" AND i."status" <> 'PAID' AND i."supersededAt" IS NULL
          ) due ON TRUE
          WHERE l."status" = 'ACTIVE' ${mine}`,
        // The receivable now, and as it stood when last month closed.
        this.prisma.$queryRaw<Array<{ now: bigint; before: bigint }>>`
          SELECT
            COALESCE(SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE -e."amount" END), 0)::bigint AS now,
            COALESCE(SUM(CASE WHEN t."effectiveOn" < ${thisMonth}::date
              THEN (CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE -e."amount" END) ELSE 0 END), 0)::bigint AS before
          FROM "LedgerEntry" e
          JOIN "LedgerAccount" a ON a."id" = e."accountId"
          JOIN "LedgerTransaction" t ON t."id" = e."transactionId"
          JOIN "Loan" l ON l."id" = e."loanId"
          WHERE a."code" = ${principalCode} ${mine}`,
        this.prisma.$queryRaw<Array<{ month: Date; amount: bigint; loans: bigint }>>`
          SELECT date_trunc('month', t."effectiveOn")::date AS month,
                 SUM(e."amount")::bigint AS amount, COUNT(DISTINCT t."loanId")::bigint AS loans
          FROM "LedgerTransaction" t
          JOIN "LedgerEntry" e ON e."transactionId" = t."id" AND e."direction" = 'DEBIT'
          JOIN "LedgerAccount" a ON a."id" = e."accountId" AND a."code" = ${principalCode}
          JOIN "Loan" l ON l."id" = t."loanId"
          WHERE t."type" = 'DISBURSEMENT' AND t."effectiveOn" >= ${firstMonth}::date ${mine}
          GROUP BY 1`,
        this.prisma.$queryRaw<Array<{ month: Date; amount: bigint }>>`
          SELECT date_trunc('month', t."effectiveOn")::date AS month, SUM(p."amount")::bigint AS amount
          FROM "Payment" p
          JOIN "LedgerTransaction" t ON t."id" = p."ledgerTransactionId"
          JOIN "Loan" l ON l."id" = p."loanId"
          WHERE p."status" = 'SUCCESSFUL' AND t."effectiveOn" >= ${firstMonth}::date ${mine}
          GROUP BY 1`,
        // Collection rate: of what fell due this month so far, how much has come in.
        this.prisma.$queryRaw<Array<{ due: bigint; paid: bigint }>>`
          SELECT COALESCE(SUM(i."principalDue" + i."interestDue" + i."feeDue"), 0)::bigint AS due,
                 COALESCE(SUM(i."principalPaid" + i."interestPaid" + i."feePaid"), 0)::bigint AS paid
          FROM "ScheduleInstalment" i JOIN "Loan" l ON l."id" = i."loanId"
          WHERE i."supersededAt" IS NULL AND i."dueDate" >= ${thisMonth}::date AND i."dueDate" <= ${today}::date ${mine}`,
        this.prisma.application.findMany({
          where: scoped ? { officerId: user.id } : {},
          orderBy: { submittedAt: 'desc' },
          take: 5,
          include: {
            borrower: { select: { fullName: true } },
            product: { select: { name: true } },
            creditScores: { orderBy: { createdAt: 'desc' }, take: 1, select: { value: true } },
          },
        }),
        this.prisma.scheduleInstalment.findMany({
          where: {
            supersededAt: null,
            status: { not: 'PAID' },
            dueDate: { gte: isoToUtcDate(today), lte: isoToUtcDate(weekEnd) },
            loan: { status: 'ACTIVE', ...(scoped ? { officerId: user.id } : {}) },
          },
          orderBy: [{ dueDate: 'asc' }, { principalDue: 'desc' }],
          take: 4,
          include: {
            loan: {
              select: {
                code: true,
                borrower: { select: { fullName: true } },
                _count: { select: { instalments: { where: { supersededAt: null } } } },
              },
            },
          },
        }),
        this.prisma.scheduleInstalment.count({
          where: {
            supersededAt: null,
            status: { not: 'PAID' },
            dueDate: { gte: isoToUtcDate(today), lte: isoToUtcDate(weekEnd) },
            loan: { status: 'ACTIVE', ...(scoped ? { officerId: user.id } : {}) },
          },
        }),
      ]);

    const buckets: Record<DpdBucket, number> = {
      CURRENT: 0,
      DPD_1_30: 0,
      DPD_31_90: 0,
      DPD_90_PLUS: 0,
    };
    const forPar = risk.map((row) => {
      buckets[dpdBucket(row.dpd)] += 1;
      return { outstandingPrincipal: row.outstanding, dpd: row.dpd };
    });
    const outstanding = balances[0]?.now ?? 0n;
    const before = balances[0]?.before ?? 0n;

    const byMonth = <T extends { month: Date }>(rows: T[]) =>
      new Map(rows.map((r) => [utcDateToIso(r.month), r]));
    const disbursedBy = byMonth(disbursed);
    const collectedBy = byMonth(collected);
    const series = Array.from({ length: 12 }, (_, i) => {
      const month = addMonths(firstMonth, i);
      return {
        month,
        label: MONTHS[Number(month.slice(5, 7)) - 1]!,
        disbursed: disbursedBy.get(month)?.amount ?? 0n,
        collected: collectedBy.get(month)?.amount ?? 0n,
      };
    });
    const thisMonthLoans = Number(disbursedBy.get(thisMonth)?.loans ?? 0n);
    const lastMonthLoans = Number(disbursedBy.get(lastMonth)?.loans ?? 0n);

    return {
      asOf: today,
      scope: scoped ? ('mine' as const) : ('all' as const),
      metrics: {
        activePortfolio: outstanding,
        // Change since last month closed, in basis points. Null with no history.
        portfolioChangeBps:
          before > 0n
            ? ratioBps(outstanding > before ? outstanding - before : before - outstanding, before) *
              (outstanding >= before ? 1 : -1)
            : null,
        activeLoans: risk.length,
        disbursedThisMonth: disbursedBy.get(thisMonth)?.amount ?? 0n,
        loansThisMonth: thisMonthLoans,
        loansVsLastMonth: thisMonthLoans - lastMonthLoans,
        lastMonthLabel: MONTHS[Number(lastMonth.slice(5, 7)) - 1]!,
        collectionRateBps:
          dueNow[0] && dueNow[0].due > 0n ? collectionRateBps(dueNow[0].paid, dueNow[0].due) : null,
        par30Bps: par30Bps(forPar),
        loansOver30: buckets.DPD_31_90 + buckets.DPD_90_PLUS,
      },
      series,
      buckets,
      recentApplications: recent.map((a) => {
        const docsMissing = a.docsReceived < a.docsRequired;
        const status: RecentStatus =
          a.stage === 'APPROVED' ||
          a.stage === 'DISBURSED' ||
          a.stage === 'DECLINED' ||
          a.stage === 'WITHDRAWN'
            ? (APPLICATION_STAGE_LABELS[a.stage] as RecentStatus)
            : docsMissing
              ? 'Docs needed'
              : a.stage === 'NEW'
                ? 'New'
                : 'In review';
        return {
          code: a.code,
          name: a.borrower.fullName,
          initials: initials(a.borrower.fullName),
          productName: a.product.name,
          amount: a.amount,
          score: a.creditScores[0]?.value ?? null,
          status,
        };
      }),
      dueThisWeek: {
        total: dueSoonCount,
        items: dueSoon.map((i) => {
          const due = utcDateToIso(i.dueDate);
          const count = i.loan._count.instalments;
          return {
            loanCode: i.loan.code,
            name: i.loan.borrower.fullName,
            weekday: WEEKDAYS[i.dueDate.getUTCDay()]!,
            day: Number(due.slice(8)),
            note: i.number === count ? 'Final instalment' : `Instalment ${i.number} of ${count}`,
            amount: instalmentRemaining(i),
          };
        }),
      },
    };
  }

  async notifications(user: AuthUser) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return {
      unread,
      items: items.map((n) => ({
        id: n.id,
        kind: n.kind,
        title: n.title,
        href: n.href,
        read: n.readAt != null,
        createdAt: n.createdAt,
      })),
    };
  }

  async markNotificationsRead(user: AuthUser): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /** Quick search from the header: borrowers by name, loans by reference. */
  async search(q: string) {
    const text = q.trim();
    if (text.length < 2) return { borrowers: [], loans: [] };
    const [borrowers, loans] = await Promise.all([
      this.prisma.borrower.findMany({
        where: {
          OR: [
            { fullName: { contains: escapeLike(text), mode: 'insensitive' } },
            { code: { contains: escapeLike(text), mode: 'insensitive' } },
          ],
        },
        orderBy: { fullName: 'asc' },
        take: 5,
        select: { code: true, fullName: true },
      }),
      this.prisma.$queryRaw<Array<{ code: string; name: string }>>`
        SELECT l."code", b."fullName" AS name
        FROM "Loan" l JOIN "Borrower" b ON b."id" = l."borrowerId"
        WHERE l."code" ILIKE ${likePattern(text)} OR b."fullName" ILIKE ${likePattern(text)}
        ORDER BY l."disbursedOn" DESC NULLS LAST
        LIMIT 5`,
    ]);
    return {
      borrowers: borrowers.map((b) => ({ code: b.code, name: b.fullName })),
      loans: loans.map((l) => ({ code: l.code, name: l.name })),
    };
  }
}
