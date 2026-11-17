import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  formatRwf,
  instalmentRemaining,
  isoToUtcDate,
  kigaliDate,
  maskPhone,
  utcDateToIso,
  borrowerLanguage,
  translate,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import { LedgerService } from '../ledger/ledger.service';
import { disbursementPosting, loanTerms, quoteFor } from '../products/terms';
import { PaymentPoster } from '../loans/payment-poster';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { SmsService } from '../sms/sms.service';

const MOMO_PREFIX = 'momo:';
/** A request nobody has answered after this long is treated as failed. */
const EXPIRE_AFTER_MS = 24 * 3_600_000;

export interface Actor {
  staffId?: string;
  borrowerId?: string;
}

/**
 * Money moving through MoMo. Every flow is request → confirm: nothing is
 * marked paid, and no loan is activated, until a status check with the
 * provider says SUCCESSFUL. Callbacks only prompt that check; their contents
 * are never trusted.
 */
@Injectable()
export class MoneyService {
  private readonly logger = new Logger(MoneyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
    private readonly poster: PaymentPoster,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly sms: SmsService,
  ) {}

  /** Ask the borrower to approve a repayment on their phone (MoMo "Request to Pay"). */
  /**
   * Ask MoMo to collect a repayment. The prompt goes to the borrower's own
   * number unless `payerPhone` names another MTN wallet (a spouse's, the
   * business's): its owner still has to approve with their PIN.
   */
  async requestPayment(
    loanCode: string,
    amount: bigint,
    actor: Actor,
    meta: RequestMeta = {},
    payerPhone?: string,
  ) {
    const loan = await this.prisma.loan.findFirst({
      where: { code: loanCode },
      include: {
        borrower: true,
        instalments: { where: { supersededAt: null, status: { not: 'PAID' } } },
        payments: { where: { status: 'PENDING' }, select: { id: true } },
      },
    });
    if (!loan || (actor.borrowerId && loan.borrowerId !== actor.borrowerId)) {
      throw new NotFoundException(`No loan ${loanCode}`);
    }
    if (loan.status !== 'ACTIVE') throw new ConflictException('This loan is not active');
    if (loan.payments.length) {
      throw new ConflictException('A MoMo request is already waiting for the borrower to approve');
    }
    const owed = loan.instalments.reduce((sum, i) => sum + instalmentRemaining(i), 0n);
    if (amount > owed)
      throw new BadRequestException(`That is more than the ${formatRwf(owed)} left to pay`);

    const payer = payerPhone ?? loan.borrower.phone;
    const referenceId = randomUUID();
    const payment = await this.prisma.payment.create({
      data: {
        loanId: loan.id,
        borrowerId: loan.borrowerId,
        amount,
        channel: 'MTN_MOMO',
        status: 'PENDING',
        idempotencyKey: `${MOMO_PREFIX}${referenceId}`,
        payerPhone: payer,
        recordedById: actor.staffId ?? null,
      },
    });
    try {
      await (
        await this.providers.momo()
      ).requestToPay({
        referenceId,
        amount,
        phone: payer,
        externalId: loan.code,
        message: `Kora Lend repayment for ${loan.code}`,
      });
    } catch (err) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failureReason: 'MoMo did not accept the request' },
      });
      this.logger.error(`Request to pay failed for ${loan.code}: ${(err as Error).message}`);
      throw new BadGatewayException('MoMo did not accept the request. Try again in a moment.');
    }
    await this.audit.record({
      action: 'loan.payment.request',
      actorId: actor.staffId ?? actor.borrowerId ?? null,
      actorType: actor.staffId ? 'STAFF' : 'BORROWER',
      entityType: 'Loan',
      entityId: loan.code,
      metadata: {
        paymentId: payment.id,
        amount,
        phone: maskPhone(payer),
        otherPayer: payer !== loan.borrower.phone,
      },
      ...meta,
    });
    return { paymentId: payment.id, status: 'PENDING' as const };
  }

  /** Check one pending repayment with MoMo, and post it if the money has arrived. */
  async settlePayment(paymentId: string): Promise<'PENDING' | 'SUCCESSFUL' | 'FAILED'> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment || !payment.idempotencyKey.startsWith(MOMO_PREFIX))
      throw new NotFoundException('No such payment');
    if (payment.status !== 'PENDING')
      return payment.status === 'SUCCESSFUL' ? 'SUCCESSFUL' : 'FAILED';

    const result = await (
      await this.providers.momo()
    ).requestToPayStatus(payment.idempotencyKey.slice(MOMO_PREFIX.length));
    if (result.status === 'PENDING') {
      if (Date.now() - payment.initiatedAt.getTime() < EXPIRE_AFTER_MS) return 'PENDING';
      result.status = 'FAILED';
      result.reason = 'The request expired without an answer';
    }
    if (result.status === 'FAILED') {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: { status: 'FAILED', failureReason: result.reason?.slice(0, 200) ?? 'Failed' },
      });
      return 'FAILED';
    }

    const posted = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Loan" WHERE "id" = ${payment.loanId}::uuid FOR UPDATE`;
        // Two confirmations can race (a callback and the poller). Only one finds it PENDING.
        const fresh = await tx.payment.findUnique({ where: { id: payment.id } });
        if (fresh?.status !== 'PENDING') return null;
        return this.poster.post(tx, {
          loanId: payment.loanId,
          amount: payment.amount,
          channel: 'MTN_MOMO',
          receivedOn: kigaliDate(),
          idempotencyKey: payment.idempotencyKey,
          externalRef: result.financialTransactionId ?? null,
          pendingPaymentId: payment.id,
          // MoMo has already taken the money; it cannot be refused now.
          acceptOverpayment: true,
        });
      },
      { timeout: 15_000 },
    );
    if (posted) await this.afterPayment(payment.id, posted.loanCode, payment.amount);
    return 'SUCCESSFUL';
  }

  /** Check one pending disbursement, and activate the loan if the money has gone out. */
  async settleDisbursement(disbursementId: string): Promise<'PENDING' | 'SUCCESSFUL' | 'FAILED'> {
    const d = await this.prisma.disbursement.findUnique({
      where: { id: disbursementId },
      include: { loan: { include: { borrower: true, application: true } } },
    });
    if (!d || !d.idempotencyKey.startsWith(MOMO_PREFIX))
      throw new NotFoundException('No such disbursement');
    if (d.status === 'SUCCESSFUL' || d.status === 'FAILED') return d.status;

    const result = await (
      await this.providers.momo()
    ).transferStatus(d.idempotencyKey.slice(MOMO_PREFIX.length));
    if (result.status === 'PENDING') {
      if (Date.now() - d.initiatedAt.getTime() < EXPIRE_AFTER_MS) return 'PENDING';
      result.status = 'FAILED';
      result.reason = 'The transfer expired without an answer';
    }
    const loan = d.loan;
    if (result.status === 'FAILED') {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.disbursement.updateMany({
          where: { id: d.id, status: { in: ['PENDING', 'SENT'] } },
          data: { status: 'FAILED', failureReason: result.reason?.slice(0, 200) ?? 'Failed' },
        });
        if (claimed.count !== 1) return;
        if (loan.applicationId) {
          await tx.application.update({
            where: { id: loan.applicationId },
            data: { statusNote: 'MoMo transfer failed. Try again.' },
          });
        }
        await this.audit.record(
          {
            action: 'loan.disburse.failed',
            actorType: 'SYSTEM',
            entityType: 'Loan',
            entityId: loan.code,
            metadata: { disbursementId: d.id, reason: result.reason },
          },
          tx,
        );
      });
      return 'FAILED';
    }

    const today = kigaliDate();
    const done = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.disbursement.updateMany({
          where: { id: d.id, status: { in: ['PENDING', 'SENT'] } },
          data: {
            status: 'SUCCESSFUL',
            confirmedAt: new Date(),
            externalRef: result.financialTransactionId ?? null,
          },
        });
        if (claimed.count !== 1) return false;
        const ledgerTransactionId = await this.ledger.post(tx, {
          type: 'DISBURSEMENT',
          idempotencyKey: d.idempotencyKey,
          loanId: loan.id,
          effectiveOn: today,
          memo: `Disbursement of ${loan.code}`,
          // Fees depend only on the amount and the loan's terms, so the quote
          // made when the transfer was requested is reproduced exactly.
          lines: disbursementPosting(
            quoteFor({
              amount: loan.application?.amount ?? loan.principal,
              termMonths: loan.termMonths,
              terms: loanTerms(loan),
              disbursedOn: today,
            }),
            'MOMO_FLOAT',
          ),
          postedById: d.initiatedById,
        });
        await tx.disbursement.update({ where: { id: d.id }, data: { ledgerTransactionId } });
        await tx.loan.update({
          where: { id: loan.id },
          data: { status: 'ACTIVE', disbursedOn: isoToUtcDate(today) },
        });
        if (loan.applicationId) {
          await tx.application.update({
            where: { id: loan.applicationId },
            data: { stage: 'DISBURSED', stageEnteredAt: new Date(), statusNote: 'Sent via MoMo' },
          });
        }
        await this.audit.record(
          {
            action: 'loan.disburse',
            actorId: d.initiatedById,
            actorType: 'SYSTEM',
            entityType: 'Loan',
            entityId: loan.code,
            metadata: {
              disbursementId: d.id,
              amount: d.amount,
              channel: 'MTN_MOMO',
              confirmedByProvider: true,
            },
          },
          tx,
        );
        return true;
      },
      { timeout: 15_000 },
    );
    if (done) {
      await this.quietly(async () => {
        await this.sms.send({
          toPhone: loan.borrower.phone,
          borrowerId: loan.borrowerId,
          loanId: loan.id,
          template: 'disbursement.sent',
          language: loan.borrower.preferredLanguage,
          body: this.sms.render(
            'disbursement.sent',
            { amount: d.amount, loanCode: loan.code, date: utcDateToIso(loan.firstDueDate) },
            loan.borrower.preferredLanguage,
          ),
        });
        if (loan.officerId) {
          await this.prisma.notification.create({
            data: {
              userId: loan.officerId,
              kind: 'PAYMENT',
              title: `${loan.code} disbursed to ${loan.borrower.fullName} via MoMo`,
              href: `/loans/${loan.code}`,
            },
          });
        }
      });
    }
    return 'SUCCESSFUL';
  }

  /** A provider callback: find what it refers to and run the usual status check. */
  async handleCallback(referenceId: string): Promise<void> {
    const key = `${MOMO_PREFIX}${referenceId}`;
    const payment = await this.prisma.payment.findFirst({
      where: { idempotencyKey: key },
      select: { id: true },
    });
    if (payment) {
      await this.settlePayment(payment.id);
      return;
    }
    const disbursement = await this.prisma.disbursement.findFirst({
      where: { idempotencyKey: key },
      select: { id: true },
    });
    if (disbursement) await this.settleDisbursement(disbursement.id);
    // An unknown reference is ignored: there is nothing of ours to update.
  }

  /** Called by the background job: follow up everything still waiting on MoMo. */
  async pollPending(): Promise<{ payments: number; disbursements: number }> {
    const [payments, disbursements] = await Promise.all([
      this.prisma.payment.findMany({
        where: { status: 'PENDING', idempotencyKey: { startsWith: MOMO_PREFIX } },
        select: { id: true },
        take: 200,
      }),
      this.prisma.disbursement.findMany({
        where: { status: { in: ['PENDING', 'SENT'] }, idempotencyKey: { startsWith: MOMO_PREFIX } },
        select: { id: true },
        take: 200,
      }),
    ]);
    for (const p of payments) await this.quietly(() => this.settlePayment(p.id));
    for (const d of disbursements) await this.quietly(() => this.settleDisbursement(d.id));
    return { payments: payments.length, disbursements: disbursements.length };
  }

  private async afterPayment(paymentId: string, loanCode: string, amount: bigint): Promise<void> {
    await this.quietly(async () => {
      const loan = await this.prisma.loan.findFirstOrThrow({
        where: { code: loanCode },
        include: { borrower: true },
      });
      await this.sms.send({
        toPhone: loan.borrower.phone,
        borrowerId: loan.borrowerId,
        loanId: loan.id,
        template: 'payment.received',
        language: loan.borrower.preferredLanguage,
        body: this.sms.render(
          'payment.received',
          { amount, loanCode },
          loan.borrower.preferredLanguage,
        ),
      });
      await this.prisma.notification.create({
        data: {
          borrowerId: loan.borrowerId,
          kind: 'PAYMENT',
          title: translate(
            borrowerLanguage(loan.borrower.preferredLanguage),
            'notice.paymentReceived',
            {
              amount: formatRwf(amount),
              code: loanCode,
            },
          ),
          href: paymentId,
        },
      });
      if (loan.officerId) {
        await this.prisma.notification.create({
          data: {
            userId: loan.officerId,
            kind: 'PAYMENT',
            title: `${loan.borrower.fullName} paid ${formatRwf(amount)} via MoMo`,
            href: `/loans/${loanCode}`,
          },
        });
      }
    });
  }

  /** Follow-ups (texts, notifications) must never undo or block the money movement itself. */
  private async quietly(work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (err) {
      this.logger.error((err as Error).message);
    }
  }
}
