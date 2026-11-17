import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  formatRwf,
  instalmentRemaining,
  isoToUtcDate,
  kigaliDate,
  penaltyAmount,
  penaltyChargeDate,
  penaltyChargesDue,
  scheduledRemaining,
  utcDateToIso,
  type IsoDate,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { Prisma } from '../generated/prisma/client';
import { LedgerService } from '../ledger/ledger.service';
import { penaltyChargeLines, penaltyWaiverLines } from '../ledger/posting';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Late penalties, under the terms each loan was signed on (Loan.latePenaltyBps
 * and penaltyGraceDays, copied from the agreement at payout). Loans without a
 * penalty term, including every loan from before agreements existed, are
 * never charged.
 */
@Injectable()
export class PenaltiesService {
  private readonly logger = new Logger(PenaltiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Charge every penalty that has fallen due by `today`. Safe to run any
   * number of times: each charge has a fixed (instalment, sequence) and a
   * fixed ledger key, so a re-run finds nothing new to do.
   */
  async chargeDue(today: IsoDate = kigaliDate()) {
    const loans = await this.prisma.loan.findMany({
      where: { status: 'ACTIVE', latePenaltyBps: { gt: 0 } },
      select: {
        id: true,
        code: true,
        borrowerId: true,
        latePenaltyBps: true,
        penaltyGraceDays: true,
        instalments: {
          where: { supersededAt: null, status: { not: 'PAID' } },
          select: { id: true, dueDate: true, penaltyCharges: { select: { sequence: true } } },
        },
      },
    });

    let charged = 0;
    let total = 0n;
    for (const loan of loans) {
      for (const inst of loan.instalments) {
        const dueDate = utcDateToIso(inst.dueDate);
        const due = penaltyChargesDue(dueDate, today, loan.penaltyGraceDays);
        if (due === 0) continue;
        const have = new Set(inst.penaltyCharges.map((c) => c.sequence));
        for (let sequence = 1; sequence <= due; sequence++) {
          if (have.has(sequence)) continue;
          const amount = await this.chargeOne(loan, inst.id, dueDate, sequence);
          if (amount > 0n) {
            charged += 1;
            total += amount;
          }
        }
      }
    }
    if (charged) this.logger.log(`Charged ${charged} late penalties, ${formatRwf(total)} in all`);
    return { charged, total };
  }

  /** One charge in its own transaction. Returns what was charged (0 if nothing). */
  private async chargeOne(
    loan: {
      id: string;
      code: string;
      borrowerId: string;
      latePenaltyBps: number;
      penaltyGraceDays: number;
    },
    instalmentId: string,
    dueDate: IsoDate,
    sequence: number,
  ): Promise<bigint> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Loan" WHERE "id" = ${loan.id}::uuid FOR UPDATE`;
        const exists = await tx.penaltyCharge.findUnique({
          where: { instalmentId_sequence: { instalmentId, sequence } },
          select: { id: true },
        });
        if (exists) return 0n;
        const inst = await tx.scheduleInstalment.findUniqueOrThrow({ where: { id: instalmentId } });
        // Charged on overdue principal and interest only: never on penalties.
        const base = scheduledRemaining(inst);
        const amount = penaltyAmount(base, loan.latePenaltyBps);
        if (amount === 0n) return 0n;
        const chargedOn = penaltyChargeDate(dueDate, sequence, loan.penaltyGraceDays);
        const ledgerTransactionId = await this.ledger.post(tx, {
          type: 'PENALTY',
          idempotencyKey: `penalty:${instalmentId}:${sequence}`,
          loanId: loan.id,
          effectiveOn: chargedOn,
          memo: `Late penalty on instalment ${inst.number}`,
          lines: penaltyChargeLines(amount),
        });
        await tx.penaltyCharge.create({
          data: {
            loanId: loan.id,
            instalmentId,
            sequence,
            chargedOn: isoToUtcDate(chargedOn),
            base,
            amount,
            ledgerTransactionId,
          },
        });
        await tx.scheduleInstalment.update({
          where: { id: instalmentId },
          data: { penaltyDue: inst.penaltyDue + amount, status: 'PARTIAL' },
        });
        await tx.notification.create({
          data: {
            borrowerId: loan.borrowerId,
            kind: 'PAYMENT',
            title: `A late penalty of ${formatRwf(amount)} was added to instalment ${inst.number} of ${loan.code}`,
          },
        });
        return amount;
      });
    } catch (err) {
      // Another run charged it at the same moment.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 0n;
      throw err;
    }
  }

  /** A manager waives a penalty, or what is left of it, with a reason. */
  async waive(
    loanCode: string,
    chargeId: string,
    reason: string,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const charge = await this.prisma.penaltyCharge.findFirst({
      where: { id: chargeId, loan: { code: loanCode } },
      select: { id: true, loanId: true },
    });
    if (!charge) throw new NotFoundException('No such penalty on this loan');
    const today = kigaliDate();

    const waived = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Loan" WHERE "id" = ${charge.loanId}::uuid FOR UPDATE`;
      const c = await tx.penaltyCharge.findUniqueOrThrow({
        where: { id: chargeId },
        include: { instalment: true },
      });
      if (c.waivedAt) throw new ConflictException('This penalty has already been waived');
      const inst = c.instalment;
      const unpaid = inst.penaltyDue - inst.penaltyPaid;
      const left = c.amount - c.waivedAmount;
      const amount = left < unpaid ? left : unpaid;
      if (amount <= 0n)
        throw new ConflictException(
          'This penalty has already been paid, so there is nothing to waive',
        );

      const waiverTransactionId = await this.ledger.post(tx, {
        type: 'PENALTY',
        idempotencyKey: `penalty-waiver:${c.id}`,
        loanId: c.loanId,
        effectiveOn: today,
        memo: `Late penalty on instalment ${inst.number} waived`,
        lines: penaltyWaiverLines(amount),
        postedById: user.id,
      });
      await tx.penaltyCharge.update({
        where: { id: c.id },
        data: {
          waivedAmount: c.waivedAmount + amount,
          waivedAt: new Date(),
          waivedById: user.id,
          waiveReason: reason,
          waiverTransactionId,
        },
      });
      const after = { ...inst, penaltyDue: inst.penaltyDue - amount };
      const cleared = instalmentRemaining(after) === 0n;
      await tx.scheduleInstalment.update({
        where: { id: inst.id },
        data: {
          penaltyDue: after.penaltyDue,
          ...(cleared ? { status: 'PAID' as const, paidAt: new Date() } : {}),
        },
      });
      // Waiving the last thing owed closes the loan.
      if (cleared) {
        const open = await tx.scheduleInstalment.count({
          where: { loanId: c.loanId, supersededAt: null, status: { not: 'PAID' } },
        });
        if (open === 0) {
          await tx.loan.update({
            where: { id: c.loanId },
            data: { status: 'REPAID', closedOn: isoToUtcDate(today) },
          });
          await tx.collectionCase.updateMany({
            where: { loanId: c.loanId, closedAt: null },
            data: { status: 'RESOLVED', closedAt: new Date() },
          });
        }
      }
      await this.audit.record(
        {
          action: 'loan.penalty.waive',
          actorId: user.id,
          entityType: 'Loan',
          entityId: loanCode,
          metadata: { chargeId: c.id, instalment: inst.number, amount, reason },
          ...meta,
        },
        tx,
      );
      return amount;
    });
    return { waived };
  }
}
