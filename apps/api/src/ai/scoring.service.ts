import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { addMonths, daysBetween, kigaliDate, monthlyEquivalent, utcDateToIso } from '@kora/core';
import type { Prisma, ScoreRecommendation } from '../generated/prisma/client';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { applicationQuote, productTerms } from '../products/terms';

interface MlReason {
  kind: 'why' | 'watch';
  text: string;
  points: number;
}

interface MlScore {
  value: number;
  recommendation: ScoreRecommendation;
  headline: string;
  repay_probability_bps: number;
  reasons: MlReason[];
  model_version: string;
}

export interface WarningItem {
  loanId: string;
  loanCode: string;
  name: string;
  initials: string;
  signals: string[];
  risk: 'high' | 'medium';
}

/**
 * Credit scores and early warnings from the ML service (services/ml). Every
 * score is stored with the exact inputs sent, the reasons that came back and
 * the model version, so any decision can be explained later.
 */
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async call<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.env.ML_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Scoring service answered ${res.status}`);
    return (await res.json()) as T;
  }

  /** MoMo inflows, oldest first, only if the borrower has agreed to share them. */
  private async inflows(borrowerId: string): Promise<number[] | null> {
    const consent = await this.prisma.consent.findFirst({
      where: { borrowerId, type: 'MOMO_HISTORY', revokedAt: null },
    });
    if (!consent) return null;
    const rows = await this.prisma.momoInflowMonth.findMany({
      where: { borrowerId },
      orderBy: { month: 'desc' },
      take: 6,
    });
    return rows.length ? rows.reverse().map((r) => Number(r.inflow)) : null;
  }

  /** Score one application. Returns null, and logs, if the scoring service is down. */
  async scoreApplication(
    code: string,
  ): Promise<{ value: number; recommendation: ScoreRecommendation } | null> {
    const app = await this.prisma.application.findFirst({
      where: { code },
      include: {
        product: true,
        borrower: {
          include: {
            loans: { include: { instalments: { where: { supersededAt: null } } } },
          },
        },
      },
    });
    if (!app) throw new NotFoundException(`No application ${code}`);
    const today = kigaliDate();
    const instalments = app.borrower.loans.flatMap((l) => l.instalments);
    const paid = instalments.filter((i) => i.status === 'PAID' && i.paidAt);
    const body = {
      history: {
        instalments_paid: paid.length,
        paid_late: paid.filter((i) => kigaliDate(i.paidAt!) > utcDateToIso(i.dueDate)).length,
        overdue_now: instalments.filter(
          (i) => i.status !== 'PAID' && utcDateToIso(i.dueDate) < today,
        ).length,
        months_as_customer: Math.max(
          0,
          Math.floor(daysBetween(utcDateToIso(app.borrower.customerSince), today) / 30),
        ),
      },
      affordability: {
        monthly_income:
          app.borrower.monthlyIncome != null ? Number(app.borrower.monthlyIncome) : null,
        stated_income: app.statedMonthlyIncome != null ? Number(app.statedMonthlyIncome) : null,
        new_instalment: Number(
          monthlyEquivalent(applicationQuote(app).instalment, productTerms(app.product).frequency),
        ),
        existing_instalments: Number(
          app.borrower.loans
            .filter((l) => l.status === 'ACTIVE')
            .reduce((s, l) => s + l.instalmentAmount, 0n),
        ),
        limit_bps: app.product.affordabilityBps,
      },
      momo_inflows: await this.inflows(app.borrowerId),
    };
    let result: MlScore;
    try {
      result = await this.call<MlScore>('/v1/score', body);
    } catch (err) {
      this.logger.warn(`Could not score ${code}: ${(err as Error).message}`);
      return null;
    }
    await this.prisma.creditScore.create({
      data: {
        borrowerId: app.borrowerId,
        applicationId: app.id,
        value: result.value,
        recommendation: result.recommendation,
        headline: result.headline,
        repayProbabilityBps: result.repay_probability_bps,
        reasons: result.reasons as unknown as Prisma.InputJsonValue,
        inputs: body as unknown as Prisma.InputJsonValue,
        modelVersion: result.model_version,
      },
    });
    return { value: result.value, recommendation: result.recommendation };
  }

  /**
   * Up-to-date borrowers who may miss their next payment. Runs nightly; the
   * collections screen also runs it when there is no result from today.
   */
  async earlyWarning(): Promise<{
    asOf: string;
    flagged: WarningItem[];
    modelVersion: string;
  } | null> {
    const today = kigaliDate();
    const cached = await this.prisma.aiNote.findFirst({
      where: { kind: 'early_warning' },
      orderBy: { createdAt: 'desc' },
    });
    if (cached && kigaliDate(cached.createdAt) === today) {
      return {
        asOf: today,
        ...(cached.content as unknown as { flagged: WarningItem[] }),
        modelVersion: cached.model,
      };
    }

    const horizon = addMonths(today, 1);
    const loans = await this.prisma.loan.findMany({
      where: { status: 'ACTIVE' },
      include: {
        borrower: { select: { id: true, fullName: true, type: true } },
        instalments: { where: { supersededAt: null }, orderBy: { number: 'asc' } },
      },
    });
    const since = new Date(Date.now() - 90 * 86_400_000);
    const parts = await this.prisma.ledgerTransaction.groupBy({
      by: ['loanId'],
      where: { type: 'REPAYMENT', memo: { startsWith: 'Part payment' }, postedAt: { gte: since } },
      _count: true,
    });
    const partBy = new Map(parts.map((p) => [p.loanId, p._count]));
    const consents = new Set(
      (
        await this.prisma.consent.findMany({
          where: { type: 'MOMO_HISTORY', revokedAt: null },
          select: { borrowerId: true },
        })
      ).map((c) => c.borrowerId),
    );
    const inflowRows = await this.prisma.momoInflowMonth.findMany({
      where: { borrowerId: { in: [...consents] } },
      orderBy: { month: 'asc' },
    });
    const inflowBy = new Map<string, number[]>();
    for (const r of inflowRows)
      inflowBy.set(r.borrowerId, [...(inflowBy.get(r.borrowerId) ?? []), Number(r.inflow)]);

    const items = [];
    const byLoan = new Map<string, (typeof loans)[number]>();
    for (const l of loans) {
      const next = l.instalments.find((i) => i.status !== 'PAID');
      if (!next) continue;
      const due = utcDateToIso(next.dueDate);
      if (due < today || due > horizon) continue; // only borrowers who are up to date
      const lastPaid = [...l.instalments].reverse().find((i) => i.status === 'PAID' && i.paidAt);
      byLoan.set(l.id, l);
      items.push({
        loan_id: l.id,
        momo_inflows: consents.has(l.borrowerId) ? (inflowBy.get(l.borrowerId) ?? null) : null,
        paid_late_last_cycle: lastPaid
          ? kigaliDate(lastPaid.paidAt!) > utcDateToIso(lastPaid.dueDate)
          : false,
        partial_payments_last_90_days: partBy.get(l.id) ?? 0,
        days_to_next_due: daysBetween(today, due),
      });
    }

    let result: {
      flagged: Array<{ loan_id: string; signals: string[]; risk: 'high' | 'medium' }>;
      model_version: string;
    };
    try {
      result = await this.call('/v1/early-warning', { loans: items });
    } catch (err) {
      this.logger.warn(`Early warning unavailable: ${(err as Error).message}`);
      return null;
    }
    const flagged: WarningItem[] = result.flagged.map((f) => {
      const l = byLoan.get(f.loan_id)!;
      const parts = l.borrower.fullName.split(' ');
      return {
        loanId: l.id,
        loanCode: l.code,
        name:
          l.borrower.type === 'BUSINESS'
            ? l.borrower.fullName
            : `${parts[0]} ${parts[1]?.charAt(0) ?? ''}.`.trim(),
        initials: parts
          .slice(0, 2)
          .map((p) => p.charAt(0))
          .join('')
          .toUpperCase(),
        signals: f.signals,
        risk: f.risk,
      };
    });
    await this.prisma.aiNote.create({
      data: {
        kind: 'early_warning',
        content: { flagged } as unknown as Prisma.InputJsonValue,
        inputs: { loansChecked: items.length, asOf: today } as Prisma.InputJsonValue,
        model: result.model_version,
      },
    });
    return { asOf: today, flagged, modelVersion: result.model_version };
  }
}
