import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { addDays, formatDate, formatRwf, isoToUtcDate, kigaliDate, utcDateToIso } from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import type { Language, SmsMessage } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { companyDisplayName } from '../tenancy/company-context';

export type SmsTemplate =
  | 'reminder.due_soon'
  | 'reminder.overdue'
  | 'payment.received'
  | 'disbursement.sent'
  | 'checkin'
  | 'otp';

export interface SmsVars {
  firstName?: string;
  amount?: bigint;
  loanCode?: string;
  date?: string;
  code?: string;
  /** The company's MoMo Pay merchant code, for reminders (see payCode()). */
  payCode?: string;
}

export interface SendSms {
  toPhone: string;
  body: string;
  borrowerId?: string | null;
  loanId?: string | null;
  template?: SmsTemplate | null;
  language?: Language;
  sentById?: string | null;
}

/** One SMS segment is 160 characters; we allow three. */
export const SMS_MAX_LENGTH = 480;

@Injectable()
export class SmsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
    private readonly audit: AuditService,
  ) {}

  /** The current company's MoMo Pay merchant code, if it has one. */
  payCode(): Promise<string | undefined> {
    return this.providers.momoPayCode();
  }

  /** How to pay, for the end of a message. The merchant code is only quoted once it is real. */
  private payHint(payCode?: string): string {
    return payCode ? `Pay with MoMo Pay ${payCode}` : 'Pay with MoMo or at a branch';
  }

  /**
   * The wording of each message, signed with the lender's own name. English
   * only for now: Kinyarwanda and French versions should be written and
   * checked by native speakers before use.
   */
  render(template: SmsTemplate, v: SmsVars): string {
    const lender = companyDisplayName();
    const hello = v.firstName ? `Hello ${v.firstName}, this is ${lender}.` : `${lender}:`;
    const amount = v.amount != null ? formatRwf(v.amount) : '';
    switch (template) {
      case 'reminder.due_soon':
        return `${hello} Your instalment of ${amount} on loan ${v.loanCode} is due on ${v.date}. ${this.payHint(v.payCode)}. Thank you.`;
      case 'reminder.overdue':
        return `${hello} A reminder that ${amount} on loan ${v.loanCode} is overdue. ${this.payHint(v.payCode)}, or reply to agree a date. Thank you.`;
      case 'payment.received':
        return `${lender}: we received ${amount} for loan ${v.loanCode}. Thank you.`;
      case 'disbursement.sent':
        return `${lender}: ${amount} for loan ${v.loanCode} has been sent to your MoMo wallet. Your first instalment is due on ${v.date}.`;
      case 'checkin':
        return `${hello} Your next instalment on loan ${v.loanCode} is due on ${v.date}. If anything has changed for you, reply and we will find a plan together.`;
      case 'otp':
        return `${lender}: your sign-in code is ${v.code}. It expires in 5 minutes. Do not share it with anyone.`;
    }
  }

  /** Send one message and keep a record of it, whatever happens. */
  async send(input: SendSms): Promise<SmsMessage> {
    const body = input.body.trim();
    if (!body) throw new BadRequestException('Write a message first');
    if (body.length > SMS_MAX_LENGTH) {
      throw new BadRequestException(`Keep the message under ${SMS_MAX_LENGTH} characters`);
    }
    const gateway = await this.providers.sms();
    const row = await this.prisma.smsMessage.create({
      data: {
        toPhone: input.toPhone,
        // One-time codes are never kept: the stored text has the code removed.
        body:
          input.template === 'otp' ? `${companyDisplayName()}: your sign-in code is ••••••.` : body,
        borrowerId: input.borrowerId ?? null,
        loanId: input.loanId ?? null,
        template: input.template ?? null,
        language: input.language ?? 'EN',
        provider: gateway.name,
        sentById: input.sentById ?? null,
      },
    });
    const result = await gateway.send(input.toPhone, body);
    const now = new Date();
    return this.prisma.smsMessage.update({
      where: { id: row.id },
      data: result.accepted
        ? {
            status: result.delivered ? 'DELIVERED' : 'SENT',
            providerMessageId: result.providerMessageId,
            sentAt: now,
            deliveredAt: result.delivered ? now : null,
          }
        : { status: 'FAILED', failureReason: result.reason?.slice(0, 200) ?? 'Not accepted' },
    });
  }

  /** Africa's Talking calls back with the final state of each message. */
  async deliveryReport(providerMessageId: string, status: string, reason?: string): Promise<void> {
    const delivered = status === 'Success';
    const failed = status === 'Failed' || status === 'Rejected';
    if (!delivered && !failed) return;
    await this.prisma.smsMessage.updateMany({
      // Never move a delivered message backwards if reports arrive out of order.
      where: { providerMessageId, status: { not: 'DELIVERED' } },
      data: delivered
        ? { status: 'DELIVERED', deliveredAt: new Date() }
        : { status: 'FAILED', failureReason: reason?.slice(0, 200) ?? status },
    });
  }

  /** A message typed by a member of staff, from the borrower profile or collections. */
  async sendToBorrower(
    borrowerCode: string,
    input: { body: string; loanCode?: string; language?: Language },
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const borrower = await this.prisma.borrower.findFirst({ where: { code: borrowerCode } });
    if (!borrower) throw new NotFoundException(`No borrower ${borrowerCode}`);
    const loan = input.loanCode
      ? await this.prisma.loan.findFirst({
          where: { code: input.loanCode, borrowerId: borrower.id },
        })
      : null;
    const sms = await this.send({
      toPhone: borrower.phone,
      body: input.body,
      borrowerId: borrower.id,
      loanId: loan?.id,
      language: input.language,
      sentById: user.id,
    });
    if (loan) {
      const openCase = await this.prisma.collectionCase.findFirst({
        where: { loanId: loan.id, closedAt: null },
        select: { id: true },
      });
      await this.prisma.contactLog.create({
        data: {
          caseId: openCase?.id,
          loanId: loan.id,
          borrowerId: borrower.id,
          staffId: user.id,
          channel: 'SMS',
          outcome: 'SENT',
          summary: sms.status === 'FAILED' ? 'SMS could not be sent' : 'SMS sent',
        },
      });
    }
    await this.audit.record({
      action: 'borrower.sms.send',
      actorId: user.id,
      entityType: 'Borrower',
      entityId: borrower.code,
      // The text stays out of the audit trail; the SmsMessage row holds it.
      metadata: { smsId: sms.id, status: sms.status, length: input.body.length },
      ...meta,
    });
    return { id: sms.id, status: sms.status, failureReason: sms.failureReason };
  }

  /**
   * Remind borrowers whose instalment falls due in the next `days` days.
   * A loan already reminded in the last three days is skipped, so pressing
   * the button twice, or the nightly job running again, does not nag anyone.
   */
  async sendDueReminders(opts: {
    days: number;
    officerId?: string | null;
    sentById?: string | null;
  }) {
    const today = kigaliDate();
    const due = await this.prisma.scheduleInstalment.findMany({
      where: {
        supersededAt: null,
        status: { not: 'PAID' },
        dueDate: { gte: isoToUtcDate(today), lte: isoToUtcDate(addDays(today, opts.days)) },
        loan: { status: 'ACTIVE', ...(opts.officerId ? { officerId: opts.officerId } : {}) },
      },
      orderBy: { dueDate: 'asc' },
      take: 500,
      include: { loan: { include: { borrower: true } } },
    });
    const recent = await this.prisma.smsMessage.findMany({
      where: {
        template: 'reminder.due_soon',
        loanId: { in: due.map((i) => i.loanId) },
        createdAt: { gte: new Date(Date.now() - 3 * 86_400_000) },
        status: { not: 'FAILED' },
      },
      select: { loanId: true },
    });
    const skip = new Set(recent.map((r) => r.loanId));
    const payCode = await this.payCode();
    let sent = 0;
    let failed = 0;
    for (const inst of due) {
      if (skip.has(inst.loanId)) continue;
      skip.add(inst.loanId);
      const borrower = inst.loan.borrower;
      const sms = await this.send({
        toPhone: borrower.phone,
        borrowerId: borrower.id,
        loanId: inst.loanId,
        template: 'reminder.due_soon',
        sentById: opts.sentById,
        body: this.render('reminder.due_soon', {
          firstName: borrower.type === 'BUSINESS' ? undefined : borrower.fullName.split(' ')[0],
          amount: inst.principalDue - inst.principalPaid + (inst.interestDue - inst.interestPaid),
          loanCode: inst.loan.code,
          date: formatDate(utcDateToIso(inst.dueDate), { year: false }),
          payCode,
        }),
      });
      if (sms.status === 'FAILED') failed += 1;
      else sent += 1;
    }
    return { sent, failed, alreadyReminded: due.length - sent - failed };
  }
}
