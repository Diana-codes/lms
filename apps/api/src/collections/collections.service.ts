import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  addDays,
  daysBetween,
  dpdBucket,
  formatDate,
  formatRwf,
  initials,
  instalmentRemaining,
  isoToUtcDate,
  kigaliDate,
  kigaliDayStart,
  maskPhone,
  ratioBps,
  shortStaffName,
  utcDateToIso,
  type DpdBucket,
  type IsoDate,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import type { CollectionAction, ContactOutcome } from '../generated/prisma/client';
import { ACCOUNTS } from '../ledger/accounts';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';

export type Outcome = 'PROMISED_TO_PAY' | 'NO_ANSWER' | 'PAID_PART' | 'DISPUTED' | 'REACHED';

export interface LogOutcomeInput {
  outcome: Outcome;
  channel: 'CALL' | 'VISIT';
  date?: IsoDate;
  amount?: bigint;
  note?: string;
}

const NEXT_STEP: Record<Outcome, CollectionAction> = {
  PROMISED_TO_PAY: 'FOLLOW_UP',
  NO_ANSWER: 'CALL',
  PAID_PART: 'CALL',
  DISPUTED: 'WAIT',
  REACHED: 'FOLLOW_UP',
};

const ACTION_LABEL: Record<CollectionAction, string> = {
  SMS: 'SMS',
  CALL: 'Call',
  FOLLOW_UP: 'Follow up',
  FIELD_VISIT: 'Field visit',
  WAIT: 'Wait',
};

const short = (u: { firstName: string; lastName: string } | null | undefined) =>
  u ? shortStaffName(u.firstName, u.lastName) : null;

interface QueueRow {
  loanId: string;
  code: string;
  borrowerId: string;
  borrowerCode: string;
  name: string;
  type: string;
  phone: string;
  officerId: string | null;
  outstanding: bigint;
  overdue: bigint;
  oldest: Date;
  caseId: string | null;
  nextAction: CollectionAction | null;
  nextActionOn: Date | null;
  assignedToId: string | null;
}

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sms: SmsService,
  ) {}

  /** Every active loan with something overdue, with its balance from the ledger. */
  private async overdueLoans(): Promise<Array<QueueRow & { dpd: number }>> {
    const today = kigaliDate();
    const rows = await this.prisma.$queryRaw<QueueRow[]>`
      SELECT
        l."id" AS "loanId", l."code", l."borrowerId", l."officerId",
        b."code" AS "borrowerCode", b."fullName" AS "name", b."type", b."phone",
        COALESCE(bal.outstanding, 0)::bigint AS "outstanding",
        due.overdue::bigint AS "overdue", due.oldest,
        c."id" AS "caseId", c."nextAction", c."nextActionOn", c."assignedToId"
      FROM "Loan" l
      JOIN "Borrower" b ON b."id" = l."borrowerId"
      JOIN LATERAL (
        SELECT MIN(i."dueDate") AS oldest,
               SUM(i."principalDue" - i."principalPaid" + i."interestDue" - i."interestPaid"
                   + i."feeDue" - i."feePaid" + i."penaltyDue" - i."penaltyPaid") AS overdue
        FROM "ScheduleInstalment" i
        WHERE i."loanId" = l."id" AND i."status" <> 'PAID' AND i."supersededAt" IS NULL
          AND i."dueDate" < ${today}::date
      ) due ON due.oldest IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE -e."amount" END) AS outstanding
        FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a."id" = e."accountId"
        WHERE e."loanId" = l."id" AND a."code" = ${ACCOUNTS.LOANS_PRINCIPAL.code}
      ) bal ON TRUE
      LEFT JOIN "CollectionCase" c ON c."loanId" = l."id" AND c."closedAt" IS NULL
      WHERE l."status" = 'ACTIVE'
      ORDER BY due.oldest ASC`;
    return rows.map((r) => ({ ...r, dpd: daysBetween(utcDateToIso(r.oldest), today) }));
  }

  async queue(user: AuthUser) {
    const today = kigaliDate();
    const loans = await this.overdueLoans();
    const loanIds = loans.map((l) => l.loanId);

    const [lastContacts, promises, recovered, portfolio] = await Promise.all([
      this.prisma.contactLog.findMany({
        where: { loanId: { in: loanIds } },
        orderBy: { occurredAt: 'desc' },
        distinct: ['loanId'],
        include: { staff: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.promiseToPay.findMany({
        where: {
          status: 'OPEN',
          promisedFor: { gte: isoToUtcDate(today), lte: isoToUtcDate(addDays(today, 7)) },
        },
        select: { amount: true },
      }),
      // Money collected this month on loans that were in arrears when it arrived.
      this.prisma.$queryRaw<Array<{ amount: bigint }>>`
        SELECT COALESCE(SUM(p."amount"), 0)::bigint AS amount
        FROM "Payment" p
        JOIN "ContactLog" c ON c."loanId" = p."loanId" AND c."occurredAt" < p."confirmedAt"
        WHERE p."status" = 'SUCCESSFUL' AND p."confirmedAt" >= date_trunc('month', ${today}::date)`,
      this.prisma.$queryRaw<Array<{ total: bigint }>>`
        SELECT COALESCE(SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE -e."amount" END), 0)::bigint AS total
        FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a."id" = e."accountId"
        WHERE a."code" = ${ACCOUNTS.LOANS_PRINCIPAL.code}`,
    ]);
    const lastByLoan = new Map(lastContacts.map((c) => [c.loanId, c]));
    const weekAgo = addDays(today, -7);
    const atRisk = loans.filter((l) => l.dpd > 30).reduce((sum, l) => sum + l.outstanding, 0n);

    const buckets: Record<Exclude<DpdBucket, 'CURRENT'>, number> = {
      DPD_1_30: 0,
      DPD_31_90: 0,
      DPD_90_PLUS: 0,
    };
    const items = loans.map((l) => {
      const bucket = dpdBucket(l.dpd) as Exclude<DpdBucket, 'CURRENT'>;
      buckets[bucket] += 1;
      const last = lastByLoan.get(l.loanId);
      const nextAction = l.nextAction ?? (l.dpd > 90 ? 'FIELD_VISIT' : l.dpd > 7 ? 'CALL' : 'SMS');
      return {
        loanCode: l.code,
        borrowerCode: l.borrowerCode,
        name: l.name,
        initials: initials(l.name),
        firstName: l.type === 'BUSINESS' ? l.name : l.name.split(' ')[0]!,
        phone: maskPhone(l.phone),
        dpd: l.dpd,
        bucket,
        overdue: l.overdue,
        outstanding: l.outstanding,
        lastContact: last ? this.describeContact(last, today) : 'No contact yet',
        nextAction,
        nextActionLabel:
          l.nextAction === 'FOLLOW_UP' && l.nextActionOn
            ? `Follow up ${formatDate(utcDateToIso(l.nextActionOn), { year: false })}`
            : l.nextAction === 'CALL' && l.nextActionOn && utcDateToIso(l.nextActionOn) > today
              ? `Call ${formatDate(utcDateToIso(l.nextActionOn), { year: false })}`
              : ACTION_LABEL[nextAction],
        assignedToId: l.assignedToId,
        mine: l.assignedToId === user.id || (!l.assignedToId && l.officerId === user.id),
      };
    });

    return {
      asOf: today,
      metrics: {
        inArrears: loans.length,
        newThisWeek: loans.filter((l) => addDays(utcDateToIso(l.oldest), 1) >= weekAgo).length,
        balanceAtRisk: atRisk,
        atRiskBps: ratioBps(atRisk, portfolio[0]?.total ?? 0n),
        promisesThisWeek: promises.length,
        promisedAmount: promises.reduce((sum, p) => sum + p.amount, 0n),
        recoveredThisMonth: recovered[0]?.amount ?? 0n,
      },
      buckets,
      items,
    };
  }

  /** One account, with its contact log, for the side panel. */
  async account(loanCode: string) {
    const loan = await this.prisma.loan.findFirst({
      where: { code: loanCode },
      include: {
        borrower: true,
        instalments: {
          where: { supersededAt: null, status: { not: 'PAID' } },
          orderBy: { dueDate: 'asc' },
        },
        contactLogs: {
          orderBy: { occurredAt: 'desc' },
          take: 20,
          include: { staff: { select: { firstName: true, lastName: true } } },
        },
        promises: { where: { status: 'OPEN' }, orderBy: { promisedFor: 'asc' }, take: 1 },
        collectionCases: { where: { closedAt: null }, take: 1 },
      },
    });
    if (!loan) throw new NotFoundException(`No loan ${loanCode}`);
    const today = kigaliDate();
    const overdue = loan.instalments.filter((i) => utcDateToIso(i.dueDate) < today);
    const promise = loan.promises[0];
    return {
      loanCode: loan.code,
      borrowerCode: loan.borrower.code,
      name: loan.borrower.fullName,
      initials: initials(loan.borrower.fullName),
      firstName:
        loan.borrower.type === 'BUSINESS'
          ? loan.borrower.fullName
          : loan.borrower.fullName.split(' ')[0]!,
      phone: maskPhone(loan.borrower.phone),
      momoLinked: loan.borrower.momoLinked,
      overdue: overdue.reduce((sum, i) => sum + instalmentRemaining(i), 0n),
      outstanding: loan.instalments.reduce((sum, i) => sum + instalmentRemaining(i), 0n),
      promise: promise ? { amount: promise.amount, date: utcDateToIso(promise.promisedFor) } : null,
      log: loan.contactLogs.map((c) => ({
        id: c.id,
        text: c.summary,
        when: `${formatDate(kigaliDate(c.occurredAt), { year: false })} · ${c.staffId ? short(c.staff) : 'system'}`,
      })),
    };
  }

  /** Record what happened on a call or visit, and set the next step. */
  async logOutcome(loanCode: string, input: LogOutcomeInput, user: AuthUser, meta: RequestMeta) {
    const loan = await this.prisma.loan.findFirst({
      where: { code: loanCode },
      include: { borrower: true },
    });
    if (!loan) throw new NotFoundException(`No loan ${loanCode}`);
    const today = kigaliDate();
    if ((input.outcome === 'PROMISED_TO_PAY' || input.outcome === 'NO_ANSWER') && !input.date) {
      throw new BadRequestException(
        input.outcome === 'PROMISED_TO_PAY' ? 'Add the promised date' : 'Add a date to call again',
      );
    }
    if (input.date && input.date < today)
      throw new BadRequestException('The date cannot be in the past');
    if (input.outcome === 'PROMISED_TO_PAY' && (!input.amount || input.amount <= 0n)) {
      throw new BadRequestException('Add the amount promised');
    }
    const when = input.date ? formatDate(input.date, { year: false }) : '';
    const summary = {
      PROMISED_TO_PAY: `Promised to pay ${formatRwf(input.amount ?? 0n)} on ${when}`,
      NO_ANSWER: `${input.channel === 'VISIT' ? 'Visit' : 'Call'} — no answer; retry ${when}`,
      PAID_PART: 'Paid in part — confirm the amount in MoMo',
      DISPUTED: 'Borrower disputes the amount — sent to supervisor',
      REACHED:
        input.note?.trim() ||
        `${input.channel === 'VISIT' ? 'Visited' : 'Called'} — spoke to the borrower`,
    }[input.outcome];

    await this.prisma.$transaction(async (tx) => {
      const openCase =
        (await tx.collectionCase.findFirst({ where: { loanId: loan.id, closedAt: null } })) ??
        (await tx.collectionCase.create({
          data: { loanId: loan.id, assignedToId: user.id, dpdAtOpen: 0 },
        }));
      await tx.collectionCase.update({
        where: { id: openCase.id },
        data: {
          status: input.outcome === 'PROMISED_TO_PAY' ? 'PROMISED' : 'OPEN',
          nextAction: NEXT_STEP[input.outcome],
          nextActionOn: input.date ? isoToUtcDate(input.date) : null,
          assignedToId: openCase.assignedToId ?? user.id,
        },
      });
      await tx.contactLog.create({
        data: {
          caseId: openCase.id,
          loanId: loan.id,
          borrowerId: loan.borrowerId,
          staffId: user.id,
          channel: input.channel,
          outcome: input.outcome as ContactOutcome,
          summary:
            input.note?.trim() && input.outcome !== 'REACHED'
              ? `${summary}. ${input.note.trim()}`
              : summary,
        },
      });
      if (input.outcome === 'PROMISED_TO_PAY') {
        await tx.promiseToPay.updateMany({
          where: { loanId: loan.id, status: 'OPEN' },
          data: { status: 'CANCELLED' },
        });
        await tx.promiseToPay.create({
          data: {
            caseId: openCase.id,
            loanId: loan.id,
            amount: input.amount!,
            promisedFor: isoToUtcDate(input.date!),
            recordedById: user.id,
          },
        });
      }
      if (input.outcome === 'DISPUTED') {
        const managers = await tx.user.findMany({
          where: { role: { in: ['MANAGER', 'ADMIN'] }, isActive: true },
          select: { id: true },
        });
        await tx.notification.createMany({
          data: managers.map((m) => ({
            userId: m.id,
            kind: 'RISK' as const,
            title: `${loan.borrower.fullName} disputes the amount on ${loan.code}`,
            href: `/collections?open=${loan.code}`,
          })),
        });
      }
      await this.audit.record(
        {
          action: 'collections.outcome',
          actorId: user.id,
          entityType: 'Loan',
          entityId: loan.code,
          metadata: {
            outcome: input.outcome,
            channel: input.channel,
            date: input.date,
            amount: input.amount,
          },
          ...meta,
        },
        tx,
      );
    });
    return this.account(loanCode);
  }

  /** The two SMS drafts for an account: the house wording, in English. */
  async drafts(loanCode: string) {
    const account = await this.account(loanCode);
    return {
      english: this.sms.render('reminder.overdue', {
        firstName: account.firstName,
        amount: account.overdue,
        loanCode,
        payCode: await this.sms.payCode(),
      }),
    };
  }

  /** Reminder SMS to every account in a bucket, skipping anyone texted today. */
  async bulkSms(bucket: Exclude<DpdBucket, 'CURRENT'> | 'ALL', user: AuthUser, meta: RequestMeta) {
    const loans = (await this.overdueLoans()).filter(
      (l) => bucket === 'ALL' || dpdBucket(l.dpd) === bucket,
    );
    const textedToday = new Set(
      (
        await this.prisma.smsMessage.findMany({
          where: {
            template: 'reminder.overdue',
            loanId: { in: loans.map((l) => l.loanId) },
            createdAt: { gte: kigaliDayStart(kigaliDate()) },
          },
          select: { loanId: true },
        })
      ).map((s) => s.loanId),
    );
    let sent = 0;
    const payCode = await this.sms.payCode();
    for (const l of loans) {
      if (textedToday.has(l.loanId)) continue;
      const sms = await this.sms.send({
        toPhone: l.phone,
        borrowerId: l.borrowerId,
        loanId: l.loanId,
        template: 'reminder.overdue',
        sentById: user.id,
        body: this.sms.render('reminder.overdue', {
          firstName: l.type === 'BUSINESS' ? undefined : l.name.split(' ')[0],
          amount: l.overdue,
          loanCode: l.code,
          payCode,
        }),
      });
      if (sms.status !== 'FAILED') {
        sent += 1;
        await this.prisma.contactLog.create({
          data: {
            caseId: l.caseId,
            loanId: l.loanId,
            borrowerId: l.borrowerId,
            staffId: user.id,
            channel: 'SMS',
            outcome: 'SENT',
            summary: 'SMS reminder sent',
          },
        });
      }
    }
    await this.audit.record({
      action: 'collections.bulk_sms',
      actorId: user.id,
      metadata: { bucket, sent, skipped: loans.length - sent },
      ...meta,
    });
    return { sent, skipped: loans.length - sent };
  }

  /** Share unassigned accounts evenly across the collections team and loan officers. */
  async assign(user: AuthUser, meta: RequestMeta) {
    const staff = await this.prisma.user.findMany({
      where: { isActive: true, role: { in: ['COLLECTIONS_AGENT', 'LOAN_OFFICER'] } },
      orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
    });
    if (!staff.length) throw new BadRequestException('Nobody to assign to');
    const loans = (await this.overdueLoans()).filter((l) => !l.assignedToId);
    const counts = new Map(staff.map((s) => [s.id, 0]));
    for (const existing of await this.prisma.collectionCase.groupBy({
      by: ['assignedToId'],
      where: { closedAt: null },
      _count: true,
    })) {
      if (existing.assignedToId && counts.has(existing.assignedToId))
        counts.set(existing.assignedToId, existing._count);
    }
    const given = new Map<string, number>();
    await this.prisma.$transaction(async (tx) => {
      for (const l of loans) {
        // Whoever has the fewest open cases gets the next one.
        const [id] = [...counts.entries()].sort((a, b) => a[1] - b[1])[0]!;
        counts.set(id, counts.get(id)! + 1);
        given.set(id, (given.get(id) ?? 0) + 1);
        if (l.caseId)
          await tx.collectionCase.update({ where: { id: l.caseId }, data: { assignedToId: id } });
        else
          await tx.collectionCase.create({
            data: { loanId: l.loanId, assignedToId: id, dpdAtOpen: l.dpd },
          });
      }
      await this.audit.record(
        {
          action: 'collections.assign',
          actorId: user.id,
          metadata: { assigned: loans.length },
          ...meta,
        },
        tx,
      );
    });
    return {
      assigned: loans.length,
      perPerson: staff
        .filter((s) => given.has(s.id))
        .map((s) => ({ name: shortStaffName(s.firstName, s.lastName), count: given.get(s.id)! })),
    };
  }

  private describeContact(
    c: { summary: string; outcome: ContactOutcome; channel: string; occurredAt: Date },
    today: IsoDate,
  ): string {
    const days = daysBetween(kigaliDate(c.occurredAt), today);
    const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
    if (c.outcome === 'PROMISED_TO_PAY')
      return c.summary.replace(/^Promised to pay (RWF [\d,]+ )?on /, 'Promised ');
    if (c.outcome === 'NO_ANSWER') return `No answer · ${when}`;
    if (c.outcome === 'PAID_PART') return `Paid part · ${when}`;
    if (c.channel === 'SMS') return `SMS · ${when}`;
    return `${c.channel === 'VISIT' ? 'Visit' : 'Call'} · ${when}`;
  }
}
