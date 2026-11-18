import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  APPLICATION_STAGE_LABELS,
  canMoveStage,
  checkAffordability,
  formatBps,
  formatRwf,
  initials,
  isoToUtcDate,
  kigaliDate,
  monthlyEquivalent,
  normaliseRwPhone,
  PIPELINE_STAGES,
  shortStaffName,
  type ApplicationStage,
  type ProductKind,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { nextApplicationCode, nextBorrowerCode, nextLoanCode } from '../common/codes';
import type { RequestMeta } from '../auth/auth.service';
import type { PaymentChannel, Prisma } from '../generated/prisma/client';
import { CHANNEL_ACCOUNT } from '../ledger/accounts';
import { LedgerService } from '../ledger/ledger.service';
import { ScoringService } from '../ai/scoring.service';
import { MoneyService } from '../money/money.service';
import { AgreementsService } from '../agreements/agreements.service';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  applicationQuote,
  disbursementPosting,
  instalmentRowsFrom,
  loanFieldsFrom,
  loanTerms,
} from '../products/terms';
import { companyFeatures, requireCompanyId } from '../tenancy/company-context';
import { keyFactsStatement } from '../products/kfs';
import { ProvidersService } from '../providers/providers.service';

/** Disbursed applications stay on the board for this long, then drop off. */
export const DISBURSED_COLUMN_DAYS = 30;

const cardInclude = {
  borrower: {
    select: { code: true, fullName: true, monthlyIncome: true, momoLinked: true, phone: true },
  },
  product: true,
  officer: { select: { id: true, firstName: true, lastName: true } },
  decidedBy: { select: { id: true, firstName: true, lastName: true } },
  secondApprover: { select: { id: true, firstName: true, lastName: true } },
  creditScores: { orderBy: { createdAt: 'desc' as const }, take: 1 },
  agreement: { select: { channel: true, acceptedAt: true, terms: true } },
  loan: {
    select: {
      code: true,
      status: true,
      disbursements: {
        orderBy: { initiatedAt: 'desc' as const },
        take: 1,
        select: { id: true, status: true, failureReason: true },
      },
    },
  },
} satisfies Prisma.ApplicationInclude;

type ApplicationRow = Prisma.ApplicationGetPayload<{ include: typeof cardInclude }>;

export type AiTone = 'ok' | 'warn' | 'flag';

function toCard(app: ApplicationRow) {
  const quote = applicationQuote(app);
  const score = app.creditScores[0] ?? null;
  const reasons = (score?.reasons as Array<{ kind: string; text: string }> | null) ?? [];
  const needsSecond =
    app.product.secondApprovalAbove != null && app.amount > app.product.secondApprovalAbove;
  return {
    code: app.code,
    stage: app.stage,
    stageLabel: APPLICATION_STAGE_LABELS[app.stage],
    stageEnteredAt: app.stageEnteredAt,
    statusNote: app.statusNote,
    borrowerName: app.borrower.fullName,
    borrowerCode: app.borrower.code,
    productCode: app.product.code,
    productName: app.product.name,
    productShortName: app.product.shortName,
    kind: app.product.kind as ProductKind,
    amount: app.amount,
    termMonths: app.termMonths,
    annualRateBps: app.annualRateBps,
    instalment: quote.instalment,
    frequency: quote.terms.frequency,
    instalmentCount: quote.rows.length,
    netDisbursed: quote.netDisbursed,
    totalFees: quote.totalFees,
    aprBps: quote.aprBps,
    agreement: app.agreement
      ? { channel: app.agreement.channel, acceptedAt: app.agreement.acceptedAt }
      : null,
    score: score?.value ?? null,
    // Stored, advisory output. A person makes every decision.
    ai: score
      ? {
          tone: (score.recommendation === 'FLAG'
            ? 'flag'
            : score.recommendation === 'REVIEW'
              ? 'warn'
              : 'ok') as AiTone,
          recommendation: score.recommendation,
          title: score.headline ?? 'Scored',
          why: reasons[0]?.text ?? '',
          modelVersion: score.modelVersion,
        }
      : null,
    officerId: app.officer?.id ?? null,
    officerInitials: app.officer
      ? initials(`${app.officer.firstName} ${app.officer.lastName}`)
      : null,
    officerName: app.officer ? shortStaffName(app.officer.firstName, app.officer.lastName) : null,
    docsReceived: app.docsReceived,
    docsRequired: app.docsRequired,
    needsSecondApproval: needsSecond,
    // Meets the product's auto-approve policy. An officer still presses the button.
    // Only offered when the company has the bulk action switched on.
    autoEligible:
      companyFeatures().autoApprove &&
      score?.recommendation === 'AUTO_APPROVE_ELIGIBLE' &&
      !needsSecond &&
      app.product.autoApproveMinScore != null &&
      score.value >= app.product.autoApproveMinScore &&
      (app.product.autoApproveMaxAmount == null ||
        app.amount <= app.product.autoApproveMaxAmount) &&
      app.docsReceived >= app.docsRequired &&
      ['NEW', 'UNDER_REVIEW', 'CREDIT_CHECK'].includes(app.stage),
    firstApprovalBy:
      app.stage !== 'APPROVED' && app.stage !== 'DISBURSED' && app.decidedBy && needsSecond
        ? {
            id: app.decidedBy.id,
            name: shortStaffName(app.decidedBy.firstName, app.decidedBy.lastName),
          }
        : null,
    declineReason: app.declineReason,
    loanCode: app.loan?.code ?? null,
    disbursement: app.loan?.disbursements[0]
      ? {
          id: app.loan.disbursements[0].id,
          status: app.loan.disbursements[0].status,
          reason: app.loan.disbursements[0].failureReason,
        }
      : null,
    submittedAt: app.submittedAt,
  };
}

export type ApplicationCard = ReturnType<typeof toCard>;

export interface CreateApplicationInput {
  name: string;
  phone: string;
  productCode: string;
  amount: bigint;
  termMonths?: number;
}

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly providers: ProvidersService,
    private readonly money: MoneyService,
    private readonly scoring: ScoringService,
    private readonly documents: DocumentsService,
    private readonly agreements: AgreementsService,
  ) {}

  /** The Key Facts Statement for an application, as if paid out today. */
  async keyFacts(code: string) {
    const app = await this.find(code);
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: requireCompanyId() },
    });
    const today = kigaliDate();
    return keyFactsStatement(
      applicationQuote(app, today),
      app.termMonths,
      {
        lender: {
          name: company.brandName ?? company.name,
          legalName: company.legalName,
          supportPhone: company.supportPhone,
          supportEmail: company.supportEmail,
          address: company.address,
        },
        borrowerName: app.borrower.fullName,
        reference: app.code,
        collateral: null,
        collateralKnown: false,
      },
      today,
    );
  }

  /** Everything on the board: applications in progress, plus recent disbursements. */
  private onBoard(): Prisma.ApplicationWhereInput {
    const disbursedSince = new Date(Date.now() - DISBURSED_COLUMN_DAYS * 86_400_000);
    return {
      OR: [
        { stage: { in: ['NEW', 'UNDER_REVIEW', 'CREDIT_CHECK', 'APPROVED'] } },
        { stage: 'DISBURSED', stageEnteredAt: { gte: disbursedSince } },
      ],
    };
  }

  /** The pipeline board: five columns, each with its cards. */
  async pipeline() {
    const apps = await this.prisma.application.findMany({
      where: this.onBoard(),
      include: cardInclude,
      orderBy: { stageEnteredAt: 'desc' },
    });
    const cards = apps.map(toCard);
    return {
      columns: PIPELINE_STAGES.map((stage) => ({
        stage,
        label: APPLICATION_STAGE_LABELS[stage],
        cards: cards.filter((c) => c.stage === stage),
      })),
    };
  }

  /** The number in the sidebar: the same applications the board shows. */
  /** Applications still being worked on (disbursed ones stay on the board but are not open). */
  async openCount(): Promise<number> {
    return this.prisma.application.count({
      where: { stage: { in: ['NEW', 'UNDER_REVIEW', 'CREDIT_CHECK', 'APPROVED'] } },
    });
  }

  async get(code: string): Promise<ApplicationCard> {
    return toCard(await this.find(code));
  }

  async create(input: CreateApplicationInput, user: AuthUser, meta: RequestMeta) {
    const phone = normaliseRwPhone(input.phone);
    if (!phone) throw new BadRequestException('Enter a Rwandan mobile number, e.g. 078 812 3412');
    const product = await this.prisma.product.findFirst({
      where: { code: input.productCode, status: 'PUBLISHED' },
    });
    if (!product) throw new BadRequestException('Choose a product');
    if (input.amount < product.minAmount || input.amount > product.maxAmount) {
      throw new BadRequestException(
        `${product.name} lends between ${formatRwf(product.minAmount)} and ${formatRwf(product.maxAmount)}`,
      );
    }
    const termMonths =
      input.termMonths ?? Math.min(Math.max(12, product.minTermMonths), product.maxTermMonths);
    if (termMonths < product.minTermMonths || termMonths > product.maxTermMonths) {
      throw new BadRequestException(
        `${product.name} runs for ${product.minTermMonths} to ${product.maxTermMonths} months`,
      );
    }

    const code = await this.prisma.$transaction(async (tx) => {
      // A known phone number means a returning borrower; otherwise a new one.
      let borrower = await tx.borrower.findFirst({ where: { phone } });
      const isNewBorrower = !borrower;
      borrower ??= await tx.borrower.create({
        data: {
          code: await nextBorrowerCode(tx),
          fullName: input.name.trim(),
          phone,
          officerId: user.id,
          branchId: user.branchId,
        },
      });
      const created = await tx.application.create({
        data: {
          code: await nextApplicationCode(tx),
          borrowerId: borrower.id,
          productId: product.id,
          amount: input.amount,
          termMonths,
          annualRateBps: product.annualRateBps,
          stage: 'NEW',
          docsRequired: product.requiredDocuments.length,
          officerId: user.id,
          branchId: user.branchId,
          channel: 'CONSOLE',
        },
      });
      await this.audit.record(
        {
          action: 'application.create',
          actorId: user.id,
          entityType: 'Application',
          entityId: created.code,
          metadata: {
            borrower: borrower.code,
            newBorrower: isNewBorrower,
            product: product.code,
            amount: input.amount,
          },
          ...meta,
        },
        tx,
      );
      // A returning borrower may already have documents on file.
      await this.documents.syncApplication(borrower.id, tx);
      return created.code;
    });
    // Score straight away; if the scoring service is down the card says "Not scored yet".
    await this.scoring.scoreApplication(code).catch(() => null);
    return this.get(code);
  }

  /** Score again, e.g. after documents arrive or the borrower shares MoMo history. */
  async rescore(code: string, user: AuthUser, meta: RequestMeta) {
    const result = await this.scoring.scoreApplication(code);
    if (!result)
      throw new BadGatewayException('The scoring service is not answering. Try again in a moment.');
    await this.audit.record({
      action: 'application.score',
      actorId: user.id,
      entityType: 'Application',
      entityId: code,
      metadata: result,
      ...meta,
    });
    return this.get(code);
  }

  /**
   * "Approve N low-risk": approve every application that meets its product's
   * auto-approve policy. A person presses the button and is recorded as the
   * decider; nothing is ever declined this way.
   */
  async approveEligible(user: AuthUser, meta: RequestMeta) {
    if (!companyFeatures().autoApprove) {
      throw new ForbiddenException('Approving low-risk applications in bulk is switched off');
    }
    const { columns } = await this.pipeline();
    const eligible = columns.flatMap((c) => c.cards).filter((c) => c.autoEligible);
    const approved: string[] = [];
    const skipped: Array<{ code: string; reason: string }> = [];
    let total = 0n;
    for (const card of eligible) {
      try {
        if (card.stage === 'NEW') await this.move(card.code, 'UNDER_REVIEW', undefined, user, meta);
        await this.approve(card.code, user, meta, { auto: true });
        approved.push(card.code);
        total += card.amount;
      } catch (err) {
        skipped.push({ code: card.code, reason: (err as Error).message });
      }
    }
    return { approved, skipped, total };
  }

  /** Move between the working stages, or decline or withdraw. Approval has its own method. */
  async move(
    code: string,
    to: 'UNDER_REVIEW' | 'CREDIT_CHECK' | 'DECLINED' | 'WITHDRAWN',
    reason: string | undefined,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const app = await this.find(code);
    this.assertCanMove(app.stage, to);
    if (to === 'DECLINED' && !reason?.trim()) {
      throw new BadRequestException('Give a reason for declining');
    }
    const decided = to === 'DECLINED';
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.application.updateMany({
        where: { id: app.id, stage: app.stage },
        data: {
          stage: to,
          stageEnteredAt: new Date(),
          statusNote: null,
          // Declining is always a person's decision, recorded against them.
          decidedById: decided ? user.id : null,
          decidedAt: decided ? new Date() : null,
          declineReason: decided ? reason!.trim() : null,
        },
      });
      if (updated.count !== 1)
        throw new ConflictException('Someone else just changed this application');
      const latest = app.creditScores[0];
      if (
        decided &&
        latest &&
        (latest.recommendation === 'APPROVE' || latest.recommendation === 'AUTO_APPROVE_ELIGIBLE')
      ) {
        await tx.creditScore.update({
          where: { id: latest.id },
          data: {
            overriddenById: user.id,
            overriddenAt: new Date(),
            overrideReason: `Declined: ${reason!.trim()}`,
          },
        });
      }
      await this.audit.record(
        {
          action: `application.${to.toLowerCase()}`,
          actorId: user.id,
          entityType: 'Application',
          entityId: app.code,
          metadata: { from: app.stage, to, reason: reason?.trim() || undefined },
          ...meta,
        },
        tx,
      );
    });
    return this.get(code);
  }

  /**
   * Approve an application. Above the product's threshold this takes two
   * different people: the first approval is recorded and the application
   * waits for a manager.
   */
  async approve(
    code: string,
    user: AuthUser,
    meta: RequestMeta,
    opts: { auto?: boolean; overrideReason?: string } = {},
  ) {
    const app = await this.find(code);
    const latest = app.creditScores[0] ?? null;
    const against = latest?.recommendation === 'FLAG' || latest?.recommendation === 'REVIEW';
    if (latest?.recommendation === 'FLAG' && !opts.overrideReason?.trim()) {
      throw new BadRequestException('This application is flagged. Say why you are approving it.');
    }
    this.assertCanMove(app.stage, 'APPROVED');

    // The affordability rule, whenever we hold a verified income.
    const income = app.borrower.monthlyIncome;
    if (income != null) {
      // Weekly and fortnightly instalments count at their monthly equivalent.
      const active = await this.prisma.loan.findMany({
        where: { borrowerId: app.borrowerId, status: 'ACTIVE' },
        select: { instalmentAmount: true, terms: true, annualRateBps: true },
      });
      const quote = applicationQuote(app);
      const check = checkAffordability({
        monthlyIncome: income,
        newInstalment: monthlyEquivalent(quote.instalment, quote.terms.frequency),
        existingInstalments: active.reduce(
          (sum, l) => sum + monthlyEquivalent(l.instalmentAmount, loanTerms(l).frequency),
          0n,
        ),
        limitBps: app.product.affordabilityBps,
      });
      if (!check.affordable) {
        throw new UnprocessableEntityException(
          `Instalments would be ${formatBps(check.ratioBps, 0)} of verified income. The limit for ${app.product.name} is ${formatBps(app.product.affordabilityBps, 0)}.`,
        );
      }
    }

    const needsSecond =
      app.product.secondApprovalAbove != null && app.amount > app.product.secondApprovalAbove;
    const isSecond = needsSecond && app.decidedById != null;
    if (isSecond) {
      if (app.decidedById === user.id) {
        throw new ConflictException('A different person must give the second approval');
      }
      if (user.role !== 'MANAGER' && user.role !== 'ADMIN') {
        throw new ForbiddenException('The second approval must come from a manager');
      }
    }
    const completes = !needsSecond || isSecond;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.application.updateMany({
        where: { id: app.id, stage: app.stage, decidedById: app.decidedById },
        data: completes
          ? {
              stage: 'APPROVED',
              stageEnteredAt: new Date(),
              statusNote: 'Ready to disburse',
              ...(isSecond
                ? { secondApproverId: user.id, secondApprovedAt: new Date() }
                : { decidedById: user.id, decidedAt: new Date() }),
              autoApproved: opts.auto === true,
            }
          : { decidedById: user.id, decidedAt: new Date(), statusNote: 'Awaiting second approval' },
      });
      if (updated.count !== 1)
        throw new ConflictException('Someone else just changed this application');
      if (latest && against) {
        // An officer going against the model's advice is recorded on the score itself.
        await tx.creditScore.update({
          where: { id: latest.id },
          data: {
            overriddenById: user.id,
            overriddenAt: new Date(),
            overrideReason:
              opts.overrideReason?.trim() ||
              `Approved despite ${(latest.recommendation ?? 'review').toLowerCase()}`,
          },
        });
      }
      await this.audit.record(
        {
          action: completes ? 'application.approve' : 'application.approve.first',
          actorId: user.id,
          entityType: 'Application',
          entityId: app.code,
          metadata: {
            amount: app.amount,
            secondApproval: isSecond,
            incomeVerified: income != null,
            aiRecommendation: latest?.recommendation ?? null,
            overrode: against,
            policyApproval: opts.auto === true,
          },
          ...meta,
        },
        tx,
      );
    });
    return this.get(code);
  }

  /**
   * Turn an approved application into a loan: the loan, its schedule, the
   * disbursement record and the ledger posting all commit together.
   * Phase 2 replaces the manual confirmation with a MoMo transfer.
   */
  async disburse(
    code: string,
    input: { channel: PaymentChannel; collateral?: string; externalRef?: string },
    user: AuthUser,
    meta: RequestMeta,
  ) {
    if (input.channel === 'MTN_MOMO')
      return this.disburseViaMomo(code, input.collateral, user, meta);
    const app = await this.find(code);
    if (app.loan) throw new ConflictException(`Already disbursed as ${app.loan.code}`);
    if (app.stage !== 'APPROVED') {
      throw new ConflictException('Only an approved application can be disbursed');
    }
    assertSeparateDisburser(app, user);

    const today = kigaliDate();
    // No signed agreement, no payout; and the loan follows what was signed.
    this.agreements.assertSignedMatches(app, today);
    const quote = applicationQuote(app, today);

    const loanCode = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.application.updateMany({
        where: { id: app.id, stage: 'APPROVED' },
        data: { stage: 'DISBURSED', stageEnteredAt: new Date(), statusNote: 'Disbursed' },
      });
      if (moved.count !== 1)
        throw new ConflictException('Someone else just changed this application');

      const newCode = await nextLoanCode(tx, today.slice(0, 4));
      const loan = await tx.loan.create({
        data: {
          code: newCode,
          borrowerId: app.borrowerId,
          applicationId: app.id,
          productId: app.productId,
          ...loanFieldsFrom(quote, app.product.version),
          annualRateBps: app.annualRateBps,
          termMonths: app.termMonths,
          status: 'ACTIVE',
          disbursedOn: isoToUtcDate(today),
          collateral: input.collateral?.trim() || null,
          officerId: app.officerId,
          branchId: app.branchId,
          instalments: { create: instalmentRowsFrom(quote, today) },
        },
      });
      const key = `disbursement:${app.code}`;
      const ledgerTransactionId = await this.ledger.post(tx, {
        type: 'DISBURSEMENT',
        idempotencyKey: key,
        loanId: loan.id,
        effectiveOn: today,
        memo: `Disbursement of ${newCode}`,
        lines: disbursementPosting(quote, CHANNEL_ACCOUNT[input.channel]),
        postedById: user.id,
      });
      await tx.disbursement.create({
        data: {
          loanId: loan.id,
          amount: quote.netDisbursed,
          channel: input.channel,
          status: 'SUCCESSFUL',
          idempotencyKey: key,
          externalRef: input.externalRef?.trim() || null,
          confirmedAt: new Date(),
          initiatedById: user.id,
          approvedById: app.secondApproverId ?? app.decidedById,
          ledgerTransactionId,
        },
      });
      await this.audit.record(
        {
          action: 'loan.disburse',
          actorId: user.id,
          entityType: 'Loan',
          entityId: newCode,
          metadata: {
            application: app.code,
            amount: app.amount,
            fee: quote.totalFees,
            channel: input.channel,
          },
          ...meta,
        },
        tx,
      );
      return newCode;
    });
    return { application: await this.get(code), loanCode };
  }

  /**
   * Send the money through MoMo. The loan is created as PENDING_DISBURSEMENT
   * with its schedule; it becomes ACTIVE, and the ledger is posted, only when
   * MoMo confirms the transfer (MoneyService.settleDisbursement).
   */
  private async disburseViaMomo(
    code: string,
    collateral: string | undefined,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const app = await this.find(code);
    if (app.stage !== 'APPROVED')
      throw new ConflictException('Only an approved application can be disbursed');
    assertSeparateDisburser(app, user);
    if (!app.borrower.momoLinked) {
      throw new ConflictException(
        'This borrower has no MoMo wallet linked. Disburse by bank transfer or cash.',
      );
    }
    if (app.loan) {
      const failed = await this.retryFailedMomo(app.loan.code, user, meta);
      if (failed) return { application: await this.get(code), ...failed };
      throw new ConflictException(`Already disbursed as ${app.loan.code}`);
    }
    const today = kigaliDate();
    // No signed agreement, no payout; and the loan follows what was signed.
    this.agreements.assertSignedMatches(app, today);
    const quote = applicationQuote(app, today);
    const referenceId = randomUUID();

    const { loanCode, disbursementId, phone } = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.application.updateMany({
        where: { id: app.id, stage: 'APPROVED' },
        data: { statusNote: 'Sending via MoMo…' },
      });
      if (claimed.count !== 1)
        throw new ConflictException('Someone else just changed this application');
      const newCode = await nextLoanCode(tx, today.slice(0, 4));
      const loan = await tx.loan.create({
        data: {
          code: newCode,
          borrowerId: app.borrowerId,
          applicationId: app.id,
          productId: app.productId,
          ...loanFieldsFrom(quote, app.product.version),
          annualRateBps: app.annualRateBps,
          termMonths: app.termMonths,
          status: 'PENDING_DISBURSEMENT',
          collateral: collateral?.trim() || null,
          officerId: app.officerId,
          branchId: app.branchId,
          instalments: { create: instalmentRowsFrom(quote, today) },
        },
      });
      const d = await tx.disbursement.create({
        data: {
          loanId: loan.id,
          amount: quote.netDisbursed,
          channel: 'MTN_MOMO',
          status: 'PENDING',
          idempotencyKey: `momo:${referenceId}`,
          payeePhone: app.borrower.phone,
          initiatedById: user.id,
          approvedById: app.secondApproverId ?? app.decidedById,
        },
      });
      await this.audit.record(
        {
          action: 'loan.disburse.requested',
          actorId: user.id,
          entityType: 'Loan',
          entityId: newCode,
          metadata: {
            application: app.code,
            amount: app.amount,
            fee: quote.totalFees,
            channel: 'MTN_MOMO',
          },
          ...meta,
        },
        tx,
      );
      return { loanCode: newCode, disbursementId: d.id, phone: app.borrower.phone };
    });

    try {
      await (
        await this.providers.momo()
      ).transfer({
        referenceId,
        amount: quote.netDisbursed,
        phone,
        externalId: loanCode,
        message: `Bridge to Finance loan ${loanCode}`,
      });
      await this.prisma.disbursement.update({
        where: { id: disbursementId },
        data: { status: 'SENT' },
      });
    } catch (err) {
      await this.prisma.disbursement.update({
        where: { id: disbursementId },
        data: { status: 'FAILED', failureReason: 'MoMo did not accept the transfer' },
      });
      await this.prisma.application.update({
        where: { id: app.id },
        data: { statusNote: 'MoMo transfer failed. Try again.' },
      });
      throw new BadGatewayException(`MoMo did not accept the transfer: ${(err as Error).message}`);
    }
    // Settle at once if the provider already answers (the simulator does, after a moment).
    const status = await this.money.settleDisbursement(disbursementId);
    return { application: await this.get(code), loanCode, disbursementId, status };
  }

  /** A loan whose MoMo transfer failed can be sent again, keeping the loan and schedule. */
  private async retryFailedMomo(loanCode: string, user: AuthUser, meta: RequestMeta) {
    const loan = await this.prisma.loan.findFirst({
      where: { code: loanCode },
      include: { borrower: true, disbursements: { orderBy: { initiatedAt: 'desc' }, take: 1 } },
    });
    if (!loan || loan.status !== 'PENDING_DISBURSEMENT') return null;
    const last = loan.disbursements[0];
    if (last && last.status !== 'FAILED')
      throw new ConflictException('A MoMo transfer is already in progress for this application');
    const referenceId = randomUUID();
    const d = await this.prisma.disbursement.create({
      data: {
        loanId: loan.id,
        amount: loan.netDisbursed ?? loan.principal,
        channel: 'MTN_MOMO',
        status: 'PENDING',
        idempotencyKey: `momo:${referenceId}`,
        payeePhone: loan.borrower.phone,
        initiatedById: user.id,
        approvedById: last?.approvedById ?? null,
      },
    });
    await this.audit.record({
      action: 'loan.disburse.retried',
      actorId: user.id,
      entityType: 'Loan',
      entityId: loan.code,
      ...meta,
    });
    try {
      await (
        await this.providers.momo()
      ).transfer({
        referenceId,
        amount: loan.netDisbursed ?? loan.principal,
        phone: loan.borrower.phone,
        externalId: loan.code,
        message: `Bridge to Finance loan ${loan.code}`,
      });
      await this.prisma.disbursement.update({ where: { id: d.id }, data: { status: 'SENT' } });
    } catch (err) {
      await this.prisma.disbursement.update({
        where: { id: d.id },
        data: { status: 'FAILED', failureReason: 'MoMo did not accept the transfer' },
      });
      throw new BadGatewayException(`MoMo did not accept the transfer: ${(err as Error).message}`);
    }
    const status = await this.money.settleDisbursement(d.id);
    return { loanCode: loan.code, disbursementId: d.id, status };
  }

  private assertCanMove(from: ApplicationStage, to: ApplicationStage): void {
    if (!canMoveStage(from, to)) {
      throw new ConflictException(
        `An application that is ${APPLICATION_STAGE_LABELS[from].toLowerCase()} cannot move to ${APPLICATION_STAGE_LABELS[to].toLowerCase()}`,
      );
    }
  }

  private async find(code: string): Promise<ApplicationRow & { borrowerId: string }> {
    const app = await this.prisma.application.findFirst({ where: { code }, include: cardInclude });
    if (!app) throw new NotFoundException(`No application ${code}`);
    return app;
  }
}

/**
 * PRD §3.5 maker-checker: with strict segregation on, whoever approved an
 * application (first or second approval) cannot also pay it out.
 */
function assertSeparateDisburser(
  app: { decidedById: string | null; secondApproverId: string | null },
  user: AuthUser,
): void {
  if (!companyFeatures().strictSegregation) return;
  if (app.decidedById === user.id || app.secondApproverId === user.id) {
    throw new ForbiddenException(
      'You approved this loan, so another manager must disburse it (segregation of duties)',
    );
  }
}
