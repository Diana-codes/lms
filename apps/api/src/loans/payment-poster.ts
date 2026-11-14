import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  allocate,
  type Allocation,
  type Component,
  daysBetween,
  divRoundHalfUp,
  formatRwf,
  isoToUtcDate,
  kigaliDate,
  owing,
  owingTotal,
  payoffQuote,
  type PayoffQuote,
  reschedule,
  utcDateToIso,
  type IsoDate,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { PaymentChannel, Prisma } from '../generated/prisma/client';
import { CHANNEL_ACCOUNT } from '../ledger/accounts';
import { LedgerService } from '../ledger/ledger.service';
import { balancedLines, type PostingLine } from '../ledger/posting';
import { loanTerms, toLedger } from '../products/terms';

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
  fees: bigint;
  penalties: bigint;
  credit: bigint;
}

type Totals = Record<Component, bigint>;
const zero = (): Totals => ({ PENALTY: 0n, FEE: 0n, INTEREST: 0n, PRINCIPAL: 0n });
const addInto = (t: Totals, a: Totals) => {
  for (const k of Object.keys(t) as Component[]) t[k] += a[k];
};

/**
 * Applies a repayment to a loan under the terms it was issued with. The one
 * place where instalments, the ledger, the payment row and the audit trail
 * change together. The caller must hold a lock on the loan row and pass its
 * transaction.
 *
 * Order of events: instalments already due are paid oldest first, each in
 * the product's component order. Anything left closes the loan if it covers
 * the payoff amount; otherwise it follows the product's overpayment rule:
 * pay the next instalments ahead, or repay principal early and recalculate
 * the rest of the schedule (shorter, or with smaller instalments).
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
          where: { supersededAt: null },
          orderBy: [{ scheduleVersion: 'asc' }, { number: 'asc' }],
        },
      },
    });
    const active = loan.status === 'ACTIVE';
    if (!active && !input.acceptOverpayment) {
      throw new ConflictException(
        loan.status === 'REPAID' ? 'This loan is fully repaid' : 'This loan is not active',
      );
    }
    if (loan.disbursedOn && daysBetween(utcDateToIso(loan.disbursedOn), input.receivedOn) < 0) {
      throw new BadRequestException('The date received is before the loan was disbursed');
    }

    const terms = loanTerms(loan);
    const ledgerRows = toLedger(loan.instalments, loan.disbursedOn);
    const rows = loan.instalments.map((db, i) => ({ db, led: ledgerRows[i]! }));
    const live = active ? rows.filter((r) => owingTotal(r.led) > 0n) : [];
    const due = live.filter((r) => daysBetween(r.led.dueDate, input.receivedOn) >= 0);
    const future = live.filter((r) => daysBetween(r.led.dueDate, input.receivedOn) < 0);

    // 1. What is due, oldest first.
    const first = allocate(
      due.map((r) => r.led),
      input.amount,
      terms.allocationOrder,
    );
    let left = first.left;
    let allocations: Allocation[] = first.allocations;

    // 2. Anything more: close the loan, pay ahead, or repay principal early.
    let payoff: PayoffQuote | null = null;
    let prepay = 0n;
    if (left > 0n && future.length) {
      const quote = payoffQuote(
        future.map((r) => r.led),
        terms,
        input.receivedOn,
      );
      const futurePrincipal = future.reduce((s, r) => s + owing(r.led).PRINCIPAL, 0n);
      const untouched = future.every(
        (r) => r.led.principalPaid + r.led.interestPaid + r.led.feePaid === 0n,
      );
      if (left >= quote.total) {
        payoff = quote;
        left -= quote.total;
      } else if (terms.overpayment === 'PAY_AHEAD' || left >= futurePrincipal || !untouched) {
        const ahead = allocate(
          future.map((r) => r.led),
          left,
          terms.allocationOrder,
        );
        allocations = [...allocations, ...ahead.allocations];
        left = ahead.left;
      } else {
        prepay = left;
        left = 0n;
      }
    }

    const credit = left;
    if (credit > 0n && !input.acceptOverpayment) {
      const most = input.amount - credit;
      throw new BadRequestException(
        most > 0n
          ? `That is more than the ${formatRwf(most)} needed to clear the loan today`
          : 'Nothing is owed on this loan',
      );
    }

    const paidAt =
      input.receivedOn === kigaliDate()
        ? new Date()
        : new Date(isoToUtcDate(input.receivedOn).getTime() + 10 * 3_600_000);

    // Instalments paid in part or in full.
    const totals = zero();
    const byNumberDue = new Map(live.map((r) => [r.led.number, r]));
    for (const part of allocations) {
      const row = byNumberDue.get(part.number)!;
      addInto(totals, part.amounts);
      await tx.scheduleInstalment.update({
        where: { id: row.db.id },
        data: {
          principalPaid: row.db.principalPaid + part.amounts.PRINCIPAL,
          interestPaid: row.db.interestPaid + part.amounts.INTEREST,
          feePaid: row.db.feePaid + part.amounts.FEE,
          penaltyPaid: row.db.penaltyPaid + part.amounts.PENALTY,
          status: part.settles ? 'PAID' : 'PARTIAL',
          paidAt: part.settles ? paidAt : null,
        },
      });
    }

    // Paying off: the remaining instalments close; interest beyond the payoff
    // rule and any fees not yet earned are not charged.
    if (payoff) {
      for (const [i, r] of future.entries()) {
        const o = owing(r.led);
        const charged =
          i === 0
            ? payoff.currentInterest
            : terms.payoff.interest === 'ALL_SCHEDULED'
              ? o.INTEREST
              : 0n;
        totals.PRINCIPAL += o.PRINCIPAL;
        totals.INTEREST += charged;
        await tx.scheduleInstalment.update({
          where: { id: r.db.id },
          data: {
            principalPaid: r.db.principalDue,
            interestDue: r.db.interestPaid + charged,
            interestPaid: r.db.interestPaid + charged,
            feeDue: r.db.feePaid,
            status: 'PAID',
            paidAt,
          },
        });
      }
    }

    // Repaying principal early: the untouched future instalments are replaced.
    let rescheduled: { count: number; instalment: bigint } | null = null;
    if (prepay > 0n) {
      totals.PRINCIPAL += prepay;
      const balance = future.reduce((s, r) => s + owing(r.led).PRINCIPAL, 0n) - prepay;
      const newRows = reschedule(
        future.map((r) => ({
          number: r.led.number,
          periodStart: r.led.periodStart,
          dueDate: r.led.dueDate,
          principal: r.led.principalDue,
          interest: r.led.interestDue,
          fee: r.led.feeDue,
        })),
        balance,
        terms,
        terms.overpayment === 'REDUCE_INSTALMENT' ? 'REDUCE_INSTALMENT' : 'REDUCE_TERM',
      );
      const version = loan.scheduleVersion + 1;
      await tx.scheduleInstalment.updateMany({
        where: { id: { in: future.map((r) => r.db.id) } },
        data: { supersededAt: new Date() },
      });
      await tx.scheduleInstalment.createMany({
        data: newRows.map((r) => ({
          loanId: loan.id,
          scheduleVersion: version,
          number: r.number,
          periodStart: isoToUtcDate(r.periodStart),
          dueDate: isoToUtcDate(r.dueDate),
          principalDue: r.principal,
          interestDue: r.interest,
          feeDue: r.fee,
        })),
      });
      const next = newRows[0]!;
      rescheduled = {
        count: newRows.length,
        instalment: next.principal + next.interest + next.fee,
      };
      await tx.loan.update({
        where: { id: loan.id },
        data: {
          scheduleVersion: version,
          instalmentAmount: rescheduled.instalment,
          maturityDate: isoToUtcDate(newRows[newRows.length - 1]!.dueDate),
        },
      });
    }

    // Spread fees split exactly between income, VAT and third parties over the loan's life.
    const feeLines = await this.feeLines(tx, loan, totals.FEE);
    const lines: PostingLine[] = [
      { account: CHANNEL_ACCOUNT[input.channel], direction: 'DEBIT', amount: input.amount },
      { account: 'LOANS_PRINCIPAL', direction: 'CREDIT', amount: totals.PRINCIPAL },
      { account: 'INTEREST_INCOME', direction: 'CREDIT', amount: totals.INTEREST },
      { account: 'PENALTY_INCOME', direction: 'CREDIT', amount: totals.PENALTY },
      ...feeLines,
      { account: 'BORROWER_CREDIT', direction: 'CREDIT', amount: credit },
    ];
    if (payoff) {
      lines.push({ account: 'FEE_INCOME', direction: 'CREDIT', amount: payoff.fee });
      lines.push({ account: 'VAT_PAYABLE', direction: 'CREDIT', amount: payoff.feeVat });
    }

    const settled = allocations.filter((a) => a.settles).map((a) => a.number);
    const memo = payoff
      ? 'Loan paid off'
      : prepay > 0n
        ? `Early repayment of ${formatRwf(prepay)}`
        : allocations.length === 0
          ? 'Payment held as credit'
          : settled.length === 0
            ? `Part payment towards instalment ${allocations[0]!.number}`
            : settled.length === 1
              ? `Instalment ${settled[0]}`
              : `Instalments ${settled[0]}–${settled[settled.length - 1]}`;

    const ledgerTransactionId = await this.ledger.post(tx, {
      type: 'REPAYMENT',
      idempotencyKey: input.idempotencyKey,
      loanId: loan.id,
      effectiveOn: input.receivedOn,
      memo,
      lines: balancedLines(lines),
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

    const owedBefore = live.reduce((s, r) => s + owingTotal(r.led), 0n);
    const toRows = allocations.reduce(
      (s, a) => s + a.amounts.PENALTY + a.amounts.FEE + a.amounts.INTEREST + a.amounts.PRINCIPAL,
      0n,
    );
    const repaid =
      active && (payoff != null || (prepay === 0n && owedBefore > 0n && toRows === owedBefore));
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
          principal: totals.PRINCIPAL,
          interest: totals.INTEREST,
          fees: totals.FEE,
          penalties: totals.PENALTY,
          credit,
          instalments: allocations.map((a) => a.number),
          ...(payoff ? { paidOff: true, waived: payoff.waived, payoffFee: payoff.fee } : {}),
          ...(rescheduled ? { earlyRepayment: prepay, ...rescheduled } : {}),
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
      principal: totals.PRINCIPAL,
      interest: totals.INTEREST,
      fees: totals.FEE + (payoff ? payoff.fee + payoff.feeVat : 0n),
      penalties: totals.PENALTY,
      credit,
    };
  }

  /**
   * Fee lines for `collected` francs of spread fees. Uses the running total
   * collected on the loan, so VAT and third-party shares add up exactly to
   * the amounts fixed at disbursement however the payments fall.
   */
  private async feeLines(
    tx: Prisma.TransactionClient,
    loan: { id: string; spreadFeeTotal: bigint; spreadFeeVat: bigint; spreadFeeThirdParty: bigint },
    collected: bigint,
  ): Promise<PostingLine[]> {
    if (collected === 0n) return [];
    if (loan.spreadFeeTotal === 0n) {
      return [{ account: 'FEE_INCOME', direction: 'CREDIT', amount: collected }];
    }
    const agg = await tx.scheduleInstalment.aggregate({
      where: { loanId: loan.id },
      _sum: { feePaid: true },
    });
    // The rows were updated above, so the sum already includes this payment.
    const after = agg._sum.feePaid ?? 0n;
    const before = after - collected;
    const share = (x: bigint, part: bigint) => divRoundHalfUp(x * part, loan.spreadFeeTotal);
    const vat = share(after, loan.spreadFeeVat) - share(before, loan.spreadFeeVat);
    const thirdParty =
      share(after, loan.spreadFeeThirdParty) - share(before, loan.spreadFeeThirdParty);
    return [
      { account: 'FEE_INCOME', direction: 'CREDIT', amount: collected - vat - thirdParty },
      { account: 'VAT_PAYABLE', direction: 'CREDIT', amount: vat },
      { account: 'THIRD_PARTY_PAYABLE', direction: 'CREDIT', amount: thirdParty },
    ];
  }
}
