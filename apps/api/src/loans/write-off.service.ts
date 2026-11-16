import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreditClassProfile,
  classifyLoan,
  daysPastDue,
  type IsoDate,
  isNonPerforming,
  isoToUtcDate,
  kigaliDate,
  utcDateToIso,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import type { PaymentChannel } from '../generated/prisma/client';
import { CHANNEL_ACCOUNT } from '../ledger/accounts';
import { LedgerService } from '../ledger/ledger.service';
import { balancedLines } from '../ledger/posting';
import { PrismaService } from '../prisma/prisma.service';
import { requireCompanyId } from '../tenancy/company-context';
import { LoanSecurityService } from './loan-security.service';

/**
 * Writing loans off and recording what is recovered afterwards (PRD §6.13,
 * BNR 59/2023). A write-off is requested by one person and approved by a
 * different manager; on approval the loan-loss allowance already held for
 * the loan absorbs what it can and the rest is expensed. The loan stays on
 * record so collections can continue.
 */
@Injectable()
export class WriteOffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly security: LoanSecurityService,
    private readonly audit: AuditService,
  ) {}

  async list(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    const rows = await this.prisma.writeOff.findMany({
      where: status ? { status } : {},
      orderBy: { requestedAt: 'desc' },
      include: { loan: { select: { code: true, borrower: { select: { fullName: true } } } } },
      take: 200,
    });
    return rows.map((r) => this.view(r));
  }

  async forLoan(loanId: string) {
    const rows = await this.prisma.writeOff.findMany({
      where: { loanId },
      orderBy: { requestedAt: 'desc' },
      include: { loan: { select: { code: true, borrower: { select: { fullName: true } } } } },
    });
    const recovered = await this.recovered(loanId);
    return { requests: rows.map((r) => this.view(r)), recovered };
  }

  async request(loanCode: string, reason: string, user: AuthUser, meta: RequestMeta) {
    const loan = await this.prisma.loan.findFirst({ where: { code: loanCode } });
    if (!loan) throw new NotFoundException(`No loan ${loanCode}`);
    if (loan.status !== 'ACTIVE')
      throw new ConflictException('Only an active loan can be written off');
    if (!isNonPerforming(loan.creditClass)) {
      throw new ConflictException(
        'Only non-performing loans (Substandard, Doubtful or Loss) can be written off',
      );
    }
    const principal = await this.ledger.outstandingPrincipal(loan.id);
    if (principal <= 0n) throw new ConflictException('Nothing is outstanding on this loan');
    const interest = await this.ledger.outstandingInterestReceivable(loan.id);
    try {
      const created = await this.prisma.writeOff.create({
        data: {
          loanId: loan.id,
          reason: reason.trim(),
          principal,
          interest: interest > 0n ? interest : 0n,
          requestedById: user.id,
        },
      });
      await this.audit.record({
        action: 'loan.writeoff.request',
        actorId: user.id,
        entityType: 'Loan',
        entityId: loan.code,
        metadata: { principal: principal.toString(), creditClass: loan.creditClass },
        ...meta,
      });
      return { id: created.id, status: created.status };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('A write-off request is already waiting for approval');
      }
      throw err;
    }
  }

  async decide(id: string, approve: boolean, user: AuthUser, meta: RequestMeta) {
    const request = await this.prisma.writeOff.findUnique({
      where: { id },
      include: { loan: { select: { code: true } } },
    });
    if (!request) throw new NotFoundException('No such write-off request');
    if (request.requestedById === user.id) {
      throw new ForbiddenException('Someone other than the requester must decide this');
    }
    const today = kigaliDate();
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: requireCompanyId() },
      select: { creditClassProfile: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Loan" WHERE "id" = ${request.loanId}::uuid FOR UPDATE`;
      const claimed = await tx.writeOff.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          decidedById: user.id,
          decidedAt: new Date(),
        },
      });
      if (claimed.count !== 1) throw new ConflictException('This request has already been decided');

      if (approve) {
        const loan = await tx.loan.findUniqueOrThrow({
          where: { id: request.loanId },
          include: {
            instalments: {
              where: { supersededAt: null, status: { not: 'PAID' } },
              orderBy: { dueDate: 'asc' },
              take: 1,
              select: { dueDate: true },
            },
          },
        });
        if (loan.status !== 'ACTIVE') throw new ConflictException('The loan is no longer active');
        const principal = await this.ledger.outstandingPrincipal(loan.id, tx);
        const accrued = await this.ledger.outstandingInterestReceivable(loan.id, tx);
        const interest = accrued > 0n ? accrued : 0n;
        if (principal <= 0n) throw new ConflictException('Nothing is outstanding on this loan');

        // The allowance held for this loan under BNR 59/2023 absorbs the loss
        // first; anything beyond it is an expense in the period.
        const dpd = daysPastDue(
          loan.instalments[0] ? utcDateToIso(loan.instalments[0].dueDate) : null,
          today,
        );
        const admissible = await this.security.admissibleForLoan(loan.id);
        const { requiredProvision } = classifyLoan(
          principal,
          dpd,
          company.creditClassProfile as CreditClassProfile,
          admissible,
        );
        const held = await this.ledger.loanLossAllowance(tx);
        const allowanceUsed = min(min(requiredProvision, held > 0n ? held : 0n), principal);

        const ledgerTransactionId = await this.ledger.post(tx, {
          type: 'WRITE_OFF',
          idempotencyKey: `writeoff:${id}`,
          loanId: loan.id,
          effectiveOn: today,
          memo: `Write-off of ${loan.code}`,
          postedById: user.id,
          lines: balancedLines([
            { account: 'LOAN_LOSS_ALLOWANCE', direction: 'DEBIT', amount: allowanceUsed },
            {
              account: 'WRITE_OFFS',
              direction: 'DEBIT',
              amount: principal - allowanceUsed + interest,
            },
            { account: 'LOANS_PRINCIPAL', direction: 'CREDIT', amount: principal },
            { account: 'INTEREST_RECEIVABLE', direction: 'CREDIT', amount: interest },
          ]),
        });
        await tx.writeOff.update({
          where: { id },
          data: { principal, interest, allowanceUsed, ledgerTransactionId },
        });
        await tx.loan.update({
          where: { id: loan.id },
          data: { status: 'WRITTEN_OFF', closedOn: isoToUtcDate(today), creditClass: 'LOSS' },
        });
      }
      await this.audit.record(
        {
          action: approve ? 'loan.writeoff.approve' : 'loan.writeoff.reject',
          actorId: user.id,
          entityType: 'Loan',
          entityId: request.loan.code,
          ...meta,
        },
        tx,
      );
    });
    return { id, status: approve ? 'APPROVED' : 'REJECTED' };
  }

  /** Money received on a written-off loan: recovery income, reported separately. */
  async recordRecovery(
    loanCode: string,
    input: {
      amount: bigint;
      channel: PaymentChannel;
      receivedOn: IsoDate;
      idempotencyKey: string;
      reference?: string;
    },
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const loan = await this.prisma.loan.findFirst({ where: { code: loanCode } });
    if (!loan) throw new NotFoundException(`No loan ${loanCode}`);
    if (loan.status !== 'WRITTEN_OFF') {
      throw new ConflictException('Recoveries are recorded only on written-off loans');
    }
    if (input.receivedOn > kigaliDate()) {
      throw new BadRequestException('The date received cannot be in the future');
    }
    const existing = await this.prisma.payment.findFirst({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return { paymentId: existing.id, duplicate: true };

    const payment = await this.prisma.$transaction(async (tx) => {
      const ledgerTransactionId = await this.ledger.post(tx, {
        type: 'RECOVERY',
        idempotencyKey: `recovery:${input.idempotencyKey}`,
        loanId: loan.id,
        effectiveOn: input.receivedOn,
        memo: `Recovery on written-off ${loan.code}`,
        postedById: user.id,
        lines: [
          { account: CHANNEL_ACCOUNT[input.channel], direction: 'DEBIT', amount: input.amount },
          { account: 'RECOVERIES', direction: 'CREDIT', amount: input.amount },
        ],
      });
      const created = await tx.payment.create({
        data: {
          loanId: loan.id,
          borrowerId: loan.borrowerId,
          amount: input.amount,
          channel: input.channel,
          status: 'SUCCESSFUL',
          idempotencyKey: input.idempotencyKey,
          externalRef: input.reference?.trim() || null,
          initiatedAt: new Date(),
          confirmedAt: new Date(),
          recordedById: user.id,
          ledgerTransactionId,
        },
      });
      await this.audit.record(
        {
          action: 'loan.recovery.record',
          actorId: user.id,
          entityType: 'Loan',
          entityId: loan.code,
          metadata: { amount: input.amount.toString(), channel: input.channel },
          ...meta,
        },
        tx,
      );
      return created;
    });
    return { paymentId: payment.id, duplicate: false };
  }

  /** Total recovered on a loan since it was written off. */
  async recovered(loanId: string): Promise<bigint> {
    const rows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT COALESCE(SUM(e."amount"), 0)::bigint AS total
      FROM "LedgerEntry" e
      JOIN "LedgerTransaction" t ON t."id" = e."transactionId"
      WHERE t."loanId" = ${loanId}::uuid AND t."type" = 'RECOVERY' AND e."direction" = 'CREDIT'`;
    return rows[0]?.total ?? 0n;
  }

  private view(r: {
    id: string;
    status: string;
    reason: string;
    principal: bigint;
    interest: bigint;
    allowanceUsed: bigint;
    requestedById: string;
    requestedAt: Date;
    decidedById: string | null;
    decidedAt: Date | null;
    loan: { code: string; borrower: { fullName: string } };
  }) {
    return {
      id: r.id,
      loanCode: r.loan.code,
      borrowerName: r.loan.borrower.fullName,
      status: r.status,
      reason: r.reason,
      principal: r.principal,
      interest: r.interest,
      allowanceUsed: r.allowanceUsed,
      requestedById: r.requestedById,
      requestedAt: r.requestedAt.toISOString(),
      decidedById: r.decidedById,
      decidedAt: r.decidedAt?.toISOString() ?? null,
    };
  }
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);
