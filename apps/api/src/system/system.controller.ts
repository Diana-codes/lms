import { Controller, Get } from '@nestjs/common';
import { type DpdBucket, dpdBucket, kigaliDate, par30Bps } from '@kora/core';
import { Roles } from '../auth/decorators';
import { ACCOUNTS } from '../ledger/accounts';
import { PrismaService } from '../prisma/prisma.service';

interface LoanRiskRow {
  outstanding: bigint;
  dpd: number;
}

/**
 * A Phase 0 smoke test for the whole stack: it reads the seeded data through
 * the ledger and the schedule, the same way the Phase 1 dashboards will.
 */
@Controller('system')
export class SystemController {
  constructor(private readonly prisma: PrismaService) {}

  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  @Get('stats')
  async stats() {
    const today = kigaliDate();
    const [staff, borrowers, applications, products, loansByStatus, totals, risk] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.borrower.count(),
        this.prisma.application.count(),
        this.prisma.product.count(),
        this.prisma.loan.groupBy({ by: ['status'], _count: true }),
        this.prisma.$queryRaw<Array<{ debits: bigint; credits: bigint; entries: bigint }>>`
          SELECT
            COALESCE(SUM("amount") FILTER (WHERE "direction" = 'DEBIT'), 0)::bigint  AS debits,
            COALESCE(SUM("amount") FILTER (WHERE "direction" = 'CREDIT'), 0)::bigint AS credits,
            COUNT(*)::bigint AS entries
          FROM "LedgerEntry"`,
        // Outstanding principal per active loan comes from the ledger;
        // days past due from the oldest unpaid instalment.
        this.prisma.$queryRaw<LoanRiskRow[]>`
          SELECT
            COALESCE(bal.outstanding, 0)::bigint AS outstanding,
            GREATEST(0, (${today}::date - due.oldest))::int AS dpd
          FROM "Loan" l
          LEFT JOIN LATERAL (
            SELECT SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE -e."amount" END) AS outstanding
            FROM "LedgerEntry" e
            JOIN "LedgerAccount" a ON a."id" = e."accountId"
            WHERE e."loanId" = l."id" AND a."code" = ${ACCOUNTS.LOANS_PRINCIPAL.code}
          ) bal ON TRUE
          LEFT JOIN LATERAL (
            SELECT MIN(i."dueDate") AS oldest
            FROM "ScheduleInstalment" i
            WHERE i."loanId" = l."id" AND i."status" <> 'PAID' AND i."supersededAt" IS NULL
          ) due ON TRUE
          WHERE l."status" = 'ACTIVE'`,
      ]);

    const buckets: Record<DpdBucket, number> = {
      CURRENT: 0,
      DPD_1_30: 0,
      DPD_31_90: 0,
      DPD_90_PLUS: 0,
    };
    let outstanding = 0n;
    const forPar = risk.map((row) => {
      buckets[dpdBucket(row.dpd)] += 1;
      outstanding += row.outstanding;
      return { outstandingPrincipal: row.outstanding, dpd: row.dpd };
    });

    const ledger = totals[0] ?? { debits: 0n, credits: 0n, entries: 0n };
    return {
      asOf: today,
      counts: {
        staff,
        borrowers,
        applications,
        products,
        loans: Object.fromEntries(loansByStatus.map((g) => [g.status, g._count])),
      },
      portfolio: {
        activeLoans: risk.length,
        outstandingPrincipal: outstanding,
        par30Bps: par30Bps(forPar),
        dpdBuckets: buckets,
      },
      ledger: {
        entries: ledger.entries,
        totalDebits: ledger.debits,
        totalCredits: ledger.credits,
        balanced: ledger.debits === ledger.credits,
      },
    };
  }
}
