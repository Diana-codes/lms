import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  addMonths,
  buildSchedule,
  daysBetween,
  daysPastDue,
  dpdBucket,
  formatRwf,
  initials,
  instalmentRemaining,
  instalmentState,
  isoToUtcDate,
  kigaliDate,
  maskPhone,
  PAYMENT_CHANNEL_LABELS,
  quoteExtendTerm,
  quotePaymentHoliday,
  scoreLabel,
  shortStaffName,
  totalRemaining,
  utcDateToIso,
  type DpdBucket,
  type IsoDate,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { likePattern } from '../common/http';
import { Prisma } from '../generated/prisma/client';
import type { LoanStatus, PaymentChannel, RestructureType } from '../generated/prisma/client';
import { ACCOUNTS } from '../ledger/accounts';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentPoster } from './payment-poster';

export const LOANS_PAGE_SIZE = 25;

const BUCKET_RANGE: Record<DpdBucket, [number, number]> = {
  CURRENT: [0, 0],
  DPD_1_30: [1, 30],
  DPD_31_90: [31, 90],
  DPD_90_PLUS: [91, 1_000_000],
};

const CHANNEL_SHORT: Record<PaymentChannel, string> = {
  MTN_MOMO: 'MoMo',
  AIRTEL_MONEY: 'Airtel Money',
  BANK_TRANSFER: 'bank transfer',
  CASH: 'cash',
};

interface LoanListRow {
  code: string;
  status: LoanStatus;
  principal: bigint;
  instalmentAmount: bigint;
  disbursedOn: Date | null;
  maturityDate: Date;
  borrowerName: string;
  borrowerCode: string;
  productName: string;
  officerFirst: string | null;
  officerLast: string | null;
  outstanding: bigint;
  nextDue: Date | null;
  dpd: number;
}

export interface LoanListQuery {
  q?: string;
  status?: LoanStatus;
  bucket?: DpdBucket;
  mine?: boolean;
  page: number;
}

export interface RecordPaymentInput {
  amount: bigint;
  channel: PaymentChannel;
  receivedOn: IsoDate;
  externalRef?: string;
  /** Made up by the client once per attempt, so a retry cannot post twice. */
  idempotencyKey: string;
}

export interface RestructureInput {
  type: RestructureType;
  newTermMonths?: number;
  reason: string;
}

export type ActivityKind = 'payment' | 'system' | 'disbursement' | 'restructure' | 'contact';

const short = (u: { firstName: string; lastName: string } | null | undefined) =>
  u ? shortStaffName(u.firstName, u.lastName) : null;

@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly poster: PaymentPoster,
  ) {}

  async list(query: LoanListQuery, user: AuthUser) {
    const today = kigaliDate();
    const filters: Prisma.Sql[] = [];
    if (query.q?.trim()) {
      const like = likePattern(query.q.trim());
      filters.push(Prisma.sql`(x."code" ILIKE ${like} OR x."borrowerName" ILIKE ${like})`);
    }
    if (query.status) filters.push(Prisma.sql`x."status" = ${query.status}::"LoanStatus"`);
    if (query.bucket) {
      const [min, max] = BUCKET_RANGE[query.bucket];
      filters.push(Prisma.sql`x."status" = 'ACTIVE' AND x."dpd" BETWEEN ${min} AND ${max}`);
    }
    if (query.mine) filters.push(Prisma.sql`x."officerId" = ${user.id}::uuid`);
    const where = filters.length
      ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`
      : Prisma.empty;

    // Outstanding principal comes from the ledger; days past due from the
    // oldest instalment that still has something owing.
    const base = Prisma.sql`
      SELECT
        l."code", l."status", l."principal", l."instalmentAmount", l."disbursedOn",
        l."maturityDate", l."officerId",
        b."fullName" AS "borrowerName", b."code" AS "borrowerCode",
        p."name" AS "productName",
        u."firstName" AS "officerFirst", u."lastName" AS "officerLast",
        COALESCE(bal.outstanding, 0)::bigint AS "outstanding",
        due.oldest AS "nextDue",
        CASE WHEN l."status" = 'ACTIVE' THEN GREATEST(0, (${today}::date - due.oldest))::int ELSE 0 END AS "dpd"
      FROM "Loan" l
      JOIN "Borrower" b ON b."id" = l."borrowerId"
      JOIN "Product" p ON p."id" = l."productId"
      LEFT JOIN "User" u ON u."id" = l."officerId"
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
      ) due ON TRUE`;

    const offset = (query.page - 1) * LOANS_PAGE_SIZE;
    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<LoanListRow[]>`
        SELECT * FROM (${base}) x ${where}
        ORDER BY x."disbursedOn" DESC NULLS LAST, x."code" DESC
        LIMIT ${LOANS_PAGE_SIZE} OFFSET ${offset}`,
      this.prisma.$queryRaw<Array<{ total: bigint; outstanding: bigint }>>`
        SELECT COUNT(*)::bigint AS total, COALESCE(SUM(x."outstanding"), 0)::bigint AS outstanding
        FROM (${base}) x ${where}`,
    ]);

    const total = Number(totals[0]?.total ?? 0n);
    return {
      page: query.page,
      pageSize: LOANS_PAGE_SIZE,
      total,
      pages: Math.max(1, Math.ceil(total / LOANS_PAGE_SIZE)),
      outstanding: totals[0]?.outstanding ?? 0n,
      items: rows.map((r) => ({
        code: r.code,
        status: r.status,
        borrowerName: r.borrowerName,
        borrowerCode: r.borrowerCode,
        productName: r.productName,
        principal: r.principal,
        outstanding: r.outstanding,
        instalment: r.instalmentAmount,
        disbursedOn: r.disbursedOn ? utcDateToIso(r.disbursedOn) : null,
        nextDue: r.status === 'ACTIVE' && r.nextDue ? utcDateToIso(r.nextDue) : null,
        dpd: r.dpd,
        bucket: r.status === 'ACTIVE' ? dpdBucket(r.dpd) : null,
        officerName: r.officerFirst ? shortStaffName(r.officerFirst, r.officerLast ?? '') : null,
      })),
    };
  }

  async detail(code: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { code },
      include: {
        borrower: {
          include: {
            business: true,
            creditScores: { orderBy: { createdAt: 'desc' }, take: 1 },
            loans: { select: { id: true, status: true } },
          },
        },
        product: true,
        officer: { select: { firstName: true, lastName: true } },
        instalments: {
          where: { supersededAt: null },
          orderBy: [{ scheduleVersion: 'asc' }, { number: 'asc' }],
        },
        payments: {
          orderBy: { confirmedAt: 'desc' },
          include: {
            recordedBy: { select: { id: true, firstName: true, lastName: true } },
            ledgerTransaction: { select: { memo: true } },
          },
        },
        disbursements: {
          orderBy: { initiatedAt: 'asc' },
          include: { initiatedBy: { select: { firstName: true, lastName: true } } },
        },
        restructures: {
          orderBy: { requestedAt: 'desc' },
          include: {
            requestedBy: { select: { id: true, firstName: true, lastName: true } },
            approvedBy: { select: { firstName: true, lastName: true } },
          },
        },
        smsMessages: { orderBy: { createdAt: 'desc' }, take: 5 },
        contactLogs: {
          orderBy: { occurredAt: 'desc' },
          take: 5,
          where: { channel: { in: ['CALL', 'VISIT', 'LETTER'] } },
          include: { staff: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    if (!loan) throw new NotFoundException(`No loan ${code}`);

    const today = kigaliDate();
    const outstanding = await this.ledger.outstandingPrincipal(loan.id);

    // The schedule, with the principal balance left after each instalment.
    const firstUnpaid = loan.instalments.find(
      (i) => i.principalDue - i.principalPaid + (i.interestDue - i.interestPaid) > 0n,
    );
    let balance = loan.instalments.reduce((sum, i) => sum + i.principalDue, 0n);
    const schedule = loan.instalments.map((i) => {
      balance -= i.principalDue;
      const dueDate = utcDateToIso(i.dueDate);
      return {
        number: i.number,
        dueDate,
        principal: i.principalDue,
        interest: i.interestDue,
        payment: i.principalDue + i.interestDue,
        paid: i.principalPaid + i.interestPaid,
        remaining: instalmentRemaining(i),
        balanceAfter: balance,
        state: instalmentState({ ...i, dueDate }, today, i.id === firstUnpaid?.id),
        paidAt: i.paidAt,
      };
    });

    const paidCount = schedule.filter((r) => r.state === 'PAID').length;
    const lateCount = schedule.filter((r) => r.state === 'OVERDUE').length;
    const next = schedule.find((r) => r.state !== 'PAID') ?? null;
    const dpd = loan.status === 'ACTIVE' ? daysPastDue(next?.dueDate ?? null, today) : 0;
    const successful = loan.payments.filter((p) => p.status === 'SUCCESSFUL');
    const totalRepaid = successful.reduce((sum, p) => sum + p.amount, 0n);
    const principalRepaid = loan.principal > outstanding ? loan.principal - outstanding : 0n;
    const disbursement = loan.disbursements[0] ?? null;
    const score = loan.borrower.creditScores[0] ?? null;
    const others = loan.borrower.loans.filter((l) => l.id !== loan.id);
    const pending = loan.restructures.find((r) => r.status === 'PENDING') ?? null;

    const statusLabel =
      loan.status === 'REPAID'
        ? 'Repaid'
        : loan.status === 'WRITTEN_OFF'
          ? 'Written off'
          : loan.status === 'PENDING_DISBURSEMENT'
            ? 'Awaiting disbursement'
            : dpd > 0
              ? `Active · ${dpd} ${dpd === 1 ? 'day' : 'days'} late`
              : 'Active · on track';

    const activity: Array<{ kind: ActivityKind; title: string; at: Date; by: string }> = [];
    for (const p of successful) {
      const what = p.ledgerTransaction?.memo ?? `Payment of ${formatRwf(p.amount)}`;
      // A MoMo request confirmed by the provider is money received, even if staff started it.
      const byHand = p.recordedBy && !p.idempotencyKey.startsWith('momo:');
      activity.push({
        kind: 'payment',
        title: byHand
          ? `${what} recorded by ${short(p.recordedBy)} (${CHANNEL_SHORT[p.channel]})`
          : `${what} received via ${CHANNEL_SHORT[p.channel]}`,
        at: p.confirmedAt ?? p.initiatedAt,
        by: '',
      });
    }
    for (const s of loan.smsMessages) {
      const label =
        s.template === 'payment.received'
          ? 'Payment receipt sent by SMS'
          : s.template === 'disbursement.sent'
            ? 'Disbursement notice sent by SMS'
            : s.template?.startsWith('reminder')
              ? 'SMS reminder sent'
              : 'SMS sent';
      activity.push({
        kind: 'system',
        title: label,
        at: s.sentAt ?? s.createdAt,
        by: s.sentById ? '' : 'auto',
      });
    }
    for (const c of loan.contactLogs) {
      activity.push({
        kind: 'contact',
        title: c.summary,
        at: c.occurredAt,
        by: short(c.staff) ?? 'system',
      });
    }
    for (const r of loan.restructures) {
      activity.push({
        kind: 'restructure',
        title: 'Restructure request sent for approval',
        at: r.requestedAt,
        by: `by ${short(r.requestedBy)}`,
      });
      if (r.decidedAt) {
        activity.push({
          kind: 'restructure',
          title: r.status === 'APPROVED' ? 'Restructure approved' : 'Restructure rejected',
          at: r.decidedAt,
          by: `by ${short(r.approvedBy)}`,
        });
      }
    }
    if (disbursement) {
      activity.push({
        kind: 'disbursement',
        title: 'Loan disbursed',
        at: disbursement.confirmedAt ?? disbursement.initiatedAt,
        by: disbursement.initiatedBy ? `by ${short(disbursement.initiatedBy)}` : '',
      });
    }
    // Newest first. A receipt or notice is sent a moment after the event it is
    // about, so it would land above that event; give such texts a short grace
    // window and list them just below.
    const AUTO_GRACE_MS = 10_000;
    const sortKey = (e: { kind: ActivityKind; by: string; at: Date }) =>
      e.kind === 'system' && e.by === 'auto' ? e.at.getTime() - AUTO_GRACE_MS : e.at.getTime();
    activity.sort((a, b) => sortKey(b) - sortKey(a));

    return {
      code: loan.code,
      status: loan.status,
      statusLabel,
      dpd,
      asOf: today,
      borrower: {
        code: loan.borrower.code,
        name: loan.borrower.fullName,
        initials: initials(loan.borrower.fullName),
        phone: maskPhone(loan.borrower.phone),
        kycStatus: loan.borrower.kycStatus,
        score: score ? { value: score.value, label: scoreLabel(score.value) } : null,
        previousLoans: others.length,
        previousLoansRepaid: others.filter((l) => l.status === 'REPAID').length,
        businessName: loan.borrower.business?.name ?? null,
        sector: loan.borrower.sector,
      },
      productName: loan.product.name,
      officerName: short(loan.officer),
      terms: {
        principal: loan.principal,
        annualRateBps: loan.annualRateBps,
        termMonths: loan.termMonths,
        instalment: loan.instalmentAmount,
        disbursedOn: loan.disbursedOn ? utcDateToIso(loan.disbursedOn) : null,
        maturityDate: utcDateToIso(loan.maturityDate),
        channel: disbursement ? PAYMENT_CHANNEL_LABELS[disbursement.channel] : null,
        collateral: loan.collateral,
      },
      figures: {
        outstandingPrincipal: outstanding,
        totalRepaid,
        totalRemaining: totalRemaining(loan.instalments),
        repaidPercent: Number((principalRepaid * 100n + loan.principal / 2n) / loan.principal),
        paidCount,
        lateCount,
        instalmentCount: schedule.length,
        remainingCount: schedule.length - paidCount,
      },
      next: next
        ? { number: next.number, dueDate: next.dueDate, amount: next.remaining, state: next.state }
        : null,
      schedule,
      payments: successful.map((p) => ({
        id: p.id,
        amount: p.amount,
        channel: PAYMENT_CHANNEL_LABELS[p.channel],
        reference: p.externalRef,
        receivedOn: kigaliDate(p.confirmedAt ?? p.initiatedAt),
        note: p.ledgerTransaction?.memo ?? null,
      })),
      pendingPayments: loan.payments
        .filter((p) => p.status === 'PENDING')
        .map((p) => ({ id: p.id, amount: p.amount, requestedAt: p.initiatedAt })),
      canRequestMomo: loan.status === 'ACTIVE' && loan.borrower.momoLinked,
      pendingRestructure: pending
        ? {
            id: pending.id,
            type: pending.type,
            reason: pending.reason,
            previousInstalment: pending.previousInstalment,
            newInstalment: pending.newInstalment,
            newTermMonths: pending.newTermMonths,
            capitalisedInterest: pending.capitalisedInterest,
            requestedById: pending.requestedById,
            requestedBy: short(pending.requestedBy),
            requestedAt: pending.requestedAt,
          }
        : null,
      activity: activity.slice(0, 8),
    };
  }

  /**
   * Record a repayment by hand. Safe to retry: the same idempotency key
   * returns the first result instead of posting again. The payment, the
   * instalment updates, the ledger entries and the audit row commit together
   * or not at all (see PaymentPoster).
   */
  async recordPayment(code: string, input: RecordPaymentInput, user: AuthUser, meta: RequestMeta) {
    const today = kigaliDate();
    if (daysBetween(input.receivedOn, today) < 0) {
      throw new BadRequestException('The date received cannot be in the future');
    }
    const key = `payment:${input.idempotencyKey}`;
    const externalRef = input.externalRef?.trim() || null;

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Lock the loan row: two payments on one loan are handled one at a time.
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "Loan" WHERE "code" = ${code} FOR UPDATE`;
        if (!locked[0]) throw new NotFoundException(`No loan ${code}`);
        const loanId = locked[0].id;

        const existing = await tx.payment.findUnique({ where: { idempotencyKey: key } });
        if (existing) {
          if (existing.loanId !== loanId || existing.amount !== input.amount) {
            throw new ConflictException('This request was already used for a different payment');
          }
          return { paymentId: existing.id, replayed: true, repaid: false };
        }
        if (externalRef) {
          const clash = await tx.payment.findFirst({
            where: { channel: input.channel, externalRef },
            select: { id: true },
          });
          if (clash) {
            throw new ConflictException('A payment with this transaction ID is already recorded');
          }
        }

        const posted = await this.poster.post(tx, {
          loanId,
          amount: input.amount,
          channel: input.channel,
          receivedOn: input.receivedOn,
          idempotencyKey: key,
          externalRef,
          recordedById: user.id,
          meta,
        });
        return {
          paymentId: posted.paymentId,
          replayed: false,
          repaid: posted.repaid,
          memo: posted.memo,
        };
      },
      { timeout: 15_000 },
    );

    return { ...result, loan: await this.detail(code) };
  }

  /** Ask for a change to the loan's terms. Nothing changes until a manager approves. */
  async requestRestructure(
    code: string,
    input: RestructureInput,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const loan = await this.prisma.loan.findUnique({
      where: { code },
      include: {
        instalments: { where: { supersededAt: null, status: { not: 'PAID' } } },
        restructures: { where: { status: 'PENDING' }, select: { id: true } },
      },
    });
    if (!loan) throw new NotFoundException(`No loan ${code}`);
    if (loan.status !== 'ACTIVE')
      throw new ConflictException('Only an active loan can be restructured');
    if (loan.restructures.length) {
      throw new ConflictException('A restructure request is already waiting for approval');
    }
    const remainingMonths = loan.instalments.length;
    if (remainingMonths === 0) throw new ConflictException('There is nothing left to restructure');

    const outstanding = await this.ledger.outstandingPrincipal(loan.id);
    const base = {
      outstandingPrincipal: outstanding,
      annualRateBps: loan.annualRateBps,
      currentInstalment: loan.instalmentAmount,
      remainingMonths,
    };
    let quote;
    let capitalised = 0n;
    if (input.type === 'EXTEND_TERM') {
      if (!input.newTermMonths || input.newTermMonths <= remainingMonths) {
        throw new BadRequestException(
          `The new term must be longer than the ${remainingMonths} instalments left`,
        );
      }
      if (input.newTermMonths > remainingMonths + 36) {
        throw new BadRequestException('A term can be extended by at most 36 months');
      }
      quote = quoteExtendTerm(base, input.newTermMonths);
    } else {
      const holiday = quotePaymentHoliday(base);
      capitalised = holiday.capitalisedInterest;
      quote = holiday;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.restructure.create({
        data: {
          loanId: loan.id,
          type: input.type,
          reason: input.reason.trim(),
          outstandingAtRequest: outstanding,
          previousInstalment: loan.instalmentAmount,
          newInstalment: quote.newInstalment,
          newTermMonths: quote.newTermMonths,
          capitalisedInterest: capitalised,
          requestedById: user.id,
        },
      });
      await this.audit.record(
        {
          action: 'loan.restructure.request',
          actorId: user.id,
          entityType: 'Loan',
          entityId: loan.code,
          metadata: { restructureId: row.id, type: input.type, newTermMonths: quote.newTermMonths },
          ...meta,
        },
        tx,
      );
      return row;
    });
    return { id: created.id, loan: await this.detail(code) };
  }

  /** Approve or reject a restructure. It must be someone other than the requester. */
  async decideRestructure(id: string, approve: boolean, user: AuthUser, meta: RequestMeta) {
    const request = await this.prisma.restructure.findUnique({
      where: { id },
      include: { loan: { select: { code: true } } },
    });
    if (!request) throw new NotFoundException('No such restructure request');
    if (request.requestedById === user.id) {
      throw new ForbiddenException('Someone other than the requester must decide this');
    }
    const today = kigaliDate();

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Loan" WHERE "id" = ${request.loanId}::uuid FOR UPDATE`;
        const claimed = await tx.restructure.updateMany({
          where: { id, status: 'PENDING' },
          data: {
            status: approve ? 'APPROVED' : 'REJECTED',
            approvedById: user.id,
            decidedAt: new Date(),
          },
        });
        if (claimed.count !== 1)
          throw new ConflictException('This request has already been decided');

        if (approve) {
          const loan = await tx.loan.findUniqueOrThrow({
            where: { id: request.loanId },
            include: {
              instalments: {
                where: { supersededAt: null },
                orderBy: [{ scheduleVersion: 'asc' }, { number: 'asc' }],
              },
            },
          });
          if (loan.status !== 'ACTIVE') throw new ConflictException('The loan is no longer active');
          const unpaid = loan.instalments.filter((i) => i.status !== 'PAID');
          const paid = loan.instalments.filter((i) => i.status === 'PAID');
          if (unpaid.length === 0)
            throw new ConflictException('There is nothing left to restructure');

          let principal = await this.ledger.outstandingPrincipal(loan.id, tx);
          const holiday = request.type === 'PAYMENT_HOLIDAY';
          let term = request.newTermMonths;
          let firstDue = utcDateToIso(unpaid[0]!.dueDate);
          if (firstDue < today) firstDue = addMonths(today, 1);

          if (holiday) {
            // Figures are worked out again from today's balance, not the request's.
            const quote = quotePaymentHoliday({
              outstandingPrincipal: principal,
              annualRateBps: loan.annualRateBps,
              currentInstalment: loan.instalmentAmount,
              remainingMonths: unpaid.length,
            });
            // The skipped month's interest joins the balance.
            await this.ledger.post(tx, {
              type: 'INTEREST_ACCRUAL',
              idempotencyKey: `restructure:${id}:capitalise`,
              loanId: loan.id,
              effectiveOn: today,
              memo: 'Interest capitalised for a payment holiday',
              lines: [
                {
                  account: 'LOANS_PRINCIPAL',
                  direction: 'DEBIT',
                  amount: quote.capitalisedInterest,
                },
                {
                  account: 'INTEREST_INCOME',
                  direction: 'CREDIT',
                  amount: quote.capitalisedInterest,
                },
              ],
              postedById: user.id,
            });
            principal = quote.newPrincipal;
            term = unpaid.length;
            firstDue = addMonths(firstDue, 1);
          }

          const schedule = buildSchedule({
            principal,
            annualRateBps: loan.annualRateBps,
            termMonths: term,
            firstDueDate: firstDue,
          });
          const version = loan.scheduleVersion + 1;
          await tx.scheduleInstalment.updateMany({
            where: { id: { in: unpaid.map((i) => i.id) } },
            data: { supersededAt: new Date() },
          });
          await tx.scheduleInstalment.createMany({
            data: schedule.rows.map((row) => ({
              loanId: loan.id,
              scheduleVersion: version,
              number: paid.length + row.number,
              dueDate: isoToUtcDate(row.dueDate),
              principalDue: row.principal,
              interestDue: row.interest,
            })),
          });
          await tx.loan.update({
            where: { id: loan.id },
            data: {
              scheduleVersion: version,
              instalmentAmount: schedule.instalment,
              termMonths: paid.length + term,
              maturityDate: isoToUtcDate(schedule.rows[schedule.rows.length - 1]!.dueDate),
            },
          });
          await tx.restructure.update({
            where: { id },
            data: { newInstalment: schedule.instalment, newTermMonths: term },
          });
        }

        await this.audit.record(
          {
            action: approve ? 'loan.restructure.approve' : 'loan.restructure.reject',
            actorId: user.id,
            entityType: 'Loan',
            entityId: request.loan.code,
            metadata: { restructureId: id, type: request.type },
            ...meta,
          },
          tx,
        );
      },
      { timeout: 15_000 },
    );
    return this.detail(request.loan.code);
  }
}
