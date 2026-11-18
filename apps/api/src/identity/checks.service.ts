import { Injectable, Logger } from '@nestjs/common';
import type { DocumentType } from '@kora/core';
import { ScoringService } from '../ai/scoring.service';
import { CashflowService } from '../cashflow/cashflow.service';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityService } from './identity.service';

const OPEN_STAGES = ['NEW', 'UNDER_REVIEW', 'CREDIT_CHECK'] as const;

/**
 * The automatic checks on what a borrower sends: their statements are
 * analysed, their ID is read and compared, and the application is scored
 * again with what was found. All advisory; staff decide. Runs after the
 * borrower's request has been answered, so they never wait for it.
 */
@Injectable()
export class ChecksService {
  private readonly logger = new Logger(ChecksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashflow: CashflowService,
    private readonly identity: IdentityService,
    private readonly scoring: ScoringService,
  ) {}

  /** After a borrower applies: everything, in order. */
  async afterApply(code: string): Promise<void> {
    const app = await this.prisma.application.findFirstOrThrow({
      where: { code },
      select: { id: true, code: true, borrowerId: true },
    });
    await this.step('statements', () => this.cashflow.autoFromBorrowerDocuments(app.id));
    await this.step('identity', () => this.identity.check(app.borrowerId));
    await this.step('score', () => this.scoring.scoreApplication(app.code));
  }

  /** After a borrower sends a document: re-run what it affects. */
  async afterDocument(borrowerId: string, type: DocumentType): Promise<void> {
    if (type !== 'NATIONAL_ID' && type !== 'FINANCIAL_STATEMENTS') return;
    const app = await this.prisma.application.findFirst({
      where: { borrowerId, stage: { in: [...OPEN_STAGES] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, code: true },
    });
    if (type === 'FINANCIAL_STATEMENTS' && app) {
      await this.step('statements', () => this.cashflow.autoFromBorrowerDocuments(app.id));
    }
    await this.step('identity', () => this.identity.check(borrowerId));
    if (app && type === 'FINANCIAL_STATEMENTS') {
      await this.step('score', () => this.scoring.scoreApplication(app.code));
    }
  }

  /** What the automatic checks found, for the application card. */
  async summary(code: string) {
    const app = await this.prisma.application.findFirst({
      where: { code },
      select: { id: true, borrowerId: true, statedMonthlyIncome: true },
    });
    if (!app) return null;
    const [identity, analysis, statements] = await Promise.all([
      this.identity.latest(app.borrowerId),
      this.prisma.cashflowAnalysis.findFirst({
        where: { applicationId: app.id, status: { not: 'SUPERSEDED' } },
        orderBy: { createdAt: 'desc' },
        include: { flags: { where: { outcome: 'PENDING' }, orderBy: { severity: 'asc' } } },
      }),
      this.prisma.cashflowDocument.findMany({
        where: { applicationId: app.id },
        select: { status: true, holderName: true, error: true },
      }),
    ]);
    return {
      identity,
      statements: analysis
        ? {
            status: analysis.status,
            automatic: analysis.createdById == null,
            averageIncome: analysis.confirmedIncome ?? analysis.aiAverageIncome,
            confirmed: analysis.confirmedIncome != null,
            statedIncome: app.statedMonthlyIncome,
            holders: [...new Set(statements.map((d) => d.holderName).filter(Boolean))] as string[],
            unreadable: statements.filter((d) => d.status === 'UNREADABLE').length,
            error: analysis.error ?? statements.find((d) => d.error)?.error ?? null,
            flags: analysis.flags.map((f) => ({
              code: f.code,
              severity: f.severity,
              message: f.message,
            })),
          }
        : null,
    };
  }

  /** Start the checks without waiting for them; failures are logged, never thrown. */
  later(work: () => Promise<void>): void {
    setImmediate(() => {
      work().catch((err: unknown) => this.logger.error(`Checks failed: ${(err as Error).message}`));
    });
  }

  private async step(name: string, work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (err) {
      this.logger.warn(`Automatic ${name} check failed: ${(err as Error).message}`);
    }
  }
}
