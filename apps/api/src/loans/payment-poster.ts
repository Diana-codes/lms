import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  allocatePayment,
  daysBetween,
  formatRwf,
  isoToUtcDate,
  kigaliDate,
  totalRemaining,
  utcDateToIso,
  type IsoDate,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { PaymentChannel, Prisma } from '../generated/prisma/client';
import { CHANNEL_ACCOUNT } from '../ledger/accounts';
import { LedgerService } from '../ledger/ledger.service';
import { balancedLines } from '../ledger/posting';

export interface PostPaymentInput {
  loanId: string;
  amount: bigint;
  channel: PaymentChannel;
  receivedOn: IsoDate;
  /** The ledger idempotency key. Also the payment's, when a new row is created. */
  idempotencyKey: string;
  externalRef?: string | null;
  /** Staff member recording it by hand. Null for money confirmed by a provider. */
  recordedById?: string | null;
  /** A PENDING payment (a MoMo request) to complete, instead of creating a new row. */
  pendingPaymentId?: string;
  /**
   * Money a provider has already collected cannot be refused. Anything beyond
   * what the loan owes is held as a credit owed back to the borrower.
   */
  acceptOverpayment?: boolean;
  meta?: RequestMeta;
}

export interface PostedPayment {
  paymentId: string;
  borrowerId: string;
  loanCode: string;
  repaid: boolean;
  memo: string;
  principal: bigint;
  interest: bigint;
  credit: bigint;
}

/**
 * Applies a repayment to a loan. The one place where instalments, the ledger,
 * the payment row and the audit trail change together. The caller must hold
 * a lock on the loan row and pass its transaction.
 */
@Injectable()
export class PaymentPoster {
  constructor(
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  async post(tx: Prisma.TransactionClient, input: PostPaymentInput): Promise<PostedPayment> {
    const loan = await tx.loan.findUniqueOrThrow({
      where: { id: input.loanId },
      include: {
        instalments: {
          where: { supersededAt: null, status: { not: 'PAID' } },
          orderBy: [{ scheduleVersion: 'asc' }, { number: 'asc' }],
        },
      },
    });
    if (loan.status !== 'ACTIVE' && !input.acceptOverpayment) {
      throw new ConflictException(
        loan.status === 'REPAID' ? 'This loan is fully repaid' : 'This loan is not active',
      );
    }
    if (loan.disbursedOn && daysBetween(utcDateToIso(loan.disbursedOn), input.receivedOn) < 0) {
      throw new BadRequestException('The date received is before the loan was disbursed');
    }

    const owed = totalRemaining(loan.instalments);
    if (input.amount > owed && !input.acceptOverpayment) {
      throw new BadRequestException(
        `That is more than the ${formatRwf(owed)} left on the schedule`,
      );
    }
    const applied = input.amount > owed ? owed : input.amount;
    const credit = input.amount - applied;
    const allocation =
      applied > 0n
        ? allocatePayment(loan.instalments, applied)
        : { allocations: [], principal: 0n, interest: 0n, unallocated: 0n };

    const paidAt =
      input.receivedOn === kigaliDate()
        ? new Date()
        : new Date(isoToUtcDate(input.receivedOn).getTime() + 10 * 3_600_000);

    for (const part of allocation.allocations) {
      const inst = loan.instalments.find((i) => i.number === part.number)!;
      await tx.scheduleInstalment.update({
        where: { id: inst.id },
        data: {
          principalPaid: inst.principalPaid + part.principal,
          interestPaid: inst.interestPaid + part.interest,
          status: part.settles ? 'PAID' : 'PARTIAL',
          paidAt: part.settles ? paidAt : null,
        },
      });
    }

    const settled = allocation.allocations.filter((a) => a.settles).map((a) => a.number);
    const first = allocation.allocations[0]?.number;
    const memo =
      first == null
        ? 'Payment held as credit'
        : settled.length === 0
          ? `Part payment towards instalment ${first}`
          : settled.length === 1
            ? `Instalment ${settled[0]}`
            : `Instalments ${settled[0]}–${settled[settled.length - 1]}`;

    const ledgerTransactionId = await this.ledger.post(tx, {
      type: 'REPAYMENT',
      idempotencyKey: input.idempotencyKey,
      loanId: loan.id,
      effectiveOn: input.receivedOn,
      memo,
      lines: balancedLines([
        { account: CHANNEL_ACCOUNT[input.channel], direction: 'DEBIT', amount: input.amount },
        { account: 'LOANS_PRINCIPAL', direction: 'CREDIT', amount: allocation.principal },
        { account: 'INTEREST_INCOME', direction: 'CREDIT', amount: allocation.interest },
        { account: 'BORROWER_CREDIT', direction: 'CREDIT', amount: credit },
      ]),
      postedById: input.recordedById ?? null,
    });

    const data = {
      status: 'SUCCESSFUL' as const,
      externalRef: input.externalRef ?? null,
      confirmedAt: paidAt,
      ledgerTransactionId,
    };
    const payment = input.pendingPaymentId
      ? await tx.payment.update({ where: { id: input.pendingPaymentId }, data })
      : await tx.payment.create({
          data: {
            ...data,
            loanId: loan.id,
            borrowerId: loan.borrowerId,
            amount: input.amount,
            channel: input.channel,
            idempotencyKey: input.idempotencyKey,
            initiatedAt: paidAt,
            recordedById: input.recordedById ?? null,
          },
        });

    const repaid = loan.status === 'ACTIVE' && applied === owed && owed > 0n;
    if (repaid) {
      await tx.loan.update({
        where: { id: loan.id },
        data: { status: 'REPAID', closedOn: isoToUtcDate(input.receivedOn) },
      });
      await tx.collectionCase.updateMany({
        where: { loanId: loan.id, closedAt: null },
        data: { status: 'RESOLVED', closedAt: new Date() },
      });
    }

    await this.audit.record(
      {
        action: input.recordedById ? 'loan.payment.record' : 'loan.payment.confirmed',
        actorId: input.recordedById ?? null,
        actorType: input.recordedById ? 'STAFF' : 'SYSTEM',
        entityType: 'Loan',
        entityId: loan.code,
        metadata: {
          paymentId: payment.id,
          amount: input.amount,
          channel: input.channel,
          receivedOn: input.receivedOn,
          principal: allocation.principal,
          interest: allocation.interest,
          credit,
          instalments: allocation.allocations.map((a) => a.number),
          closedLoan: repaid,
        },
        ...input.meta,
      },
      tx,
    );

    return {
      paymentId: payment.id,
      borrowerId: loan.borrowerId,
      loanCode: loan.code,
      repaid,
      memo,
      principal: allocation.principal,
      interest: allocation.interest,
      credit,
    };
  }
}
