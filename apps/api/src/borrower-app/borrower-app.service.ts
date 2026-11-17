import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  addMonths,
  buildSchedule,
  costOfCredit,
  calcInstalment,
  checkAffordability,
  formatBps,
  formatDate,
  formatRwf,
  initials,
  instalmentRemaining,
  instalmentState,
  isoToUtcDate,
  kigaliDate,
  maskNationalId,
  isMtnRwPhone,
  maskPhone,
  normaliseRwPhone,
  PAYMENT_CHANNEL_LABELS,
  utcDateToIso,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import { nextApplicationCode } from '../common/codes';
import { PiiCrypto } from '../common/pii-crypto';
import { ENV, type Env } from '../config/env';
import type { KycDocumentType, Prisma } from '../generated/prisma/client';
import { ScoringService } from '../ai/scoring.service';
import { MoneyService } from '../money/money.service';
import { AgreementsService } from '../agreements/agreements.service';
import { AGREEMENT_VERSION } from '../agreements/template';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';

export interface ApplyInput {
  productCode: string;
  amount: bigint;
  termMonths: number;
  purpose: string;
  businessName?: string;
  businessSector?: string;
  monthlyRevenue?: bigint;
  nationalId?: string;
  shareMomoHistory: boolean;
  agreedTerms: boolean;
  agreedBureau: boolean;
  consentVersion: string;
  /** The agreement version the borrower read and accepted. */
  agreementVersion: string;
  idPhotoKey?: string;
  selfieKey?: string;
}

const mimeOfKey = (key: string) =>
  key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

const PURPOSES = ['Stock', 'Equipment', 'Expand shop', 'School fees', 'Other'];

@Injectable()
export class BorrowerAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly money: MoneyService,
    private readonly sms: SmsService,
    private readonly audit: AuditService,
    private readonly crypto: PiiCrypto,
    @Inject(ENV) private readonly env: Env,
    private readonly scoring: ScoringService,
    private readonly documents: DocumentsService,
    private readonly agreements: AgreementsService,
  ) {}

  /** Everything the home screen shows. */
  async home(borrowerId: string) {
    const today = kigaliDate();
    const b = await this.prisma.borrower.findUniqueOrThrow({
      where: { id: borrowerId },
      include: {
        officer: { select: { firstName: true, lastName: true } },
        branch: { select: { name: true } },
        loans: {
          where: { status: { in: ['ACTIVE', 'PENDING_DISBURSEMENT'] } },
          orderBy: { createdAt: 'desc' },
          include: {
            instalments: { where: { supersededAt: null }, orderBy: { number: 'asc' } },
            payments: {
              where: { status: { in: ['SUCCESSFUL', 'PENDING'] } },
              orderBy: { initiatedAt: 'desc' },
              take: 10,
            },
          },
        },
        applications: {
          where: { stage: { in: ['NEW', 'UNDER_REVIEW', 'CREDIT_CHECK', 'APPROVED'] } },
          orderBy: { submittedAt: 'desc' },
          take: 1,
          include: { product: true },
        },
        offers: {
          where: { acceptedAt: null, dismissedAt: null, expiresOn: { gte: isoToUtcDate(today) } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { product: true },
        },
        notifications: { where: { readAt: null }, select: { id: true } },
      },
    });
    const loan = b.loans.find((l) => l.status === 'ACTIVE') ?? null;
    const firstName = b.type === 'BUSINESS' ? b.fullName : b.fullName.split(' ')[0]!;

    let current = null;
    if (loan) {
      const firstUnpaid = loan.instalments.find((i) => instalmentRemaining(i) > 0n);
      const paid = loan.instalments.filter((i) => instalmentRemaining(i) === 0n).length;
      const principalPaid = loan.instalments.reduce((s, i) => s + i.principalPaid, 0n);
      const left = loan.instalments.reduce((s, i) => s + instalmentRemaining(i), 0n);
      const next = firstUnpaid
        ? {
            number: firstUnpaid.number,
            dueDate: utcDateToIso(firstUnpaid.dueDate),
            amount: instalmentRemaining(firstUnpaid),
            state: instalmentState(
              { ...firstUnpaid, dueDate: utcDateToIso(firstUnpaid.dueDate) },
              today,
              true,
            ),
          }
        : null;
      current = {
        code: loan.code,
        instalmentCount: loan.instalments.length,
        paidCount: paid,
        repaidPercent: Number((principalPaid * 100n + loan.principal / 2n) / loan.principal),
        totalLeft: left,
        next,
        pendingPayment: loan.payments.find((p) => p.status === 'PENDING')
          ? { id: loan.payments.find((p) => p.status === 'PENDING')!.id }
          : null,
        activity: loan.payments
          .filter((p) => p.status === 'SUCCESSFUL')
          .slice(0, 5)
          .map((p) => {
            const inst = loan.instalments.find(
              (i) =>
                i.paidAt &&
                p.confirmedAt &&
                Math.abs(i.paidAt.getTime() - p.confirmedAt.getTime()) < 1000,
            );
            const on = kigaliDate(p.confirmedAt ?? p.initiatedAt);
            const early = inst ? utcDateToIso(inst.dueDate) > on : false;
            return {
              id: p.id,
              title: inst
                ? `Instalment ${inst.number} paid${early ? ' early' : ''}`
                : 'Payment received',
              when: `${formatDate(on, { year: false })} · ${PAYMENT_CHANNEL_LABELS[p.channel]}`,
              amount: p.amount,
            };
          }),
      };
    }

    const offer = b.offers[0];
    const pendingApp = b.applications[0];
    return {
      firstName,
      initials: initials(b.fullName),
      unread: b.notifications.length,
      loan: current,
      pendingLoan: b.loans.find((l) => l.status === 'PENDING_DISBURSEMENT')
        ? { code: b.loans.find((l) => l.status === 'PENDING_DISBURSEMENT')!.code }
        : null,
      application: pendingApp
        ? {
            code: pendingApp.code,
            amount: pendingApp.amount,
            stage: pendingApp.stage,
            productName: pendingApp.product.name,
          }
        : null,
      offer: offer
        ? {
            id: offer.id,
            maxAmount: offer.maxAmount,
            termMonths: offer.termMonths,
            productCode: offer.product.code,
            productName: offer.product.name,
            annualRateBps: offer.product.annualRateBps,
          }
        : null,
      wallet: b.momoLinked ? `MTN MoMo · ${maskPhone(b.phone).replace('+250 ', '0')}` : null,
      support: {
        officerName: b.officer ? `${b.officer.firstName} ${b.officer.lastName.charAt(0)}.` : null,
        branch: b.branch?.name ?? null,
      },
      documentsNeeded: (await this.documents.checklist(borrowerId)).needsAction,
    };
  }

  /** The full schedule of the current loan. */
  async schedule(borrowerId: string, code: string) {
    const loan = await this.prisma.loan.findFirst({
      where: { code, borrowerId },
      include: { instalments: { where: { supersededAt: null }, orderBy: { number: 'asc' } } },
    });
    if (!loan) throw new NotFoundException('No such loan');
    const today = kigaliDate();
    const first = loan.instalments.find((i) => instalmentRemaining(i) > 0n);
    return {
      code: loan.code,
      principal: loan.principal,
      annualRateBps: loan.annualRateBps,
      rows: loan.instalments.map((i) => ({
        number: i.number,
        dueDate: utcDateToIso(i.dueDate),
        amount: i.principalDue + i.interestDue,
        // Late penalties on this instalment, included in what is left to pay.
        penalty: i.penaltyDue,
        remaining: instalmentRemaining(i),
        state: instalmentState(
          { ...i, dueDate: utcDateToIso(i.dueDate) },
          today,
          i.id === first?.id,
        ),
      })),
    };
  }

  /** "Pay with MoMo": a Request to Pay for the next instalment, or an amount of the borrower's choosing. */
  async pay(
    borrowerId: string,
    code: string,
    amount: bigint | undefined,
    meta: RequestMeta,
    phone?: string,
  ) {
    // Paying from someone else's wallet: it must be a real MTN Rwanda number.
    let payer: string | undefined;
    if (phone) {
      const e164 = normaliseRwPhone(phone);
      if (!e164) throw new BadRequestException('Enter a Rwandan mobile number, like 078 123 4567');
      if (!isMtnRwPhone(e164))
        throw new BadRequestException('MoMo payments need an MTN number starting 078 or 079');
      payer = e164;
    }
    const loan = await this.prisma.loan.findFirst({
      where: { code, borrowerId },
      include: {
        borrower: true,
        instalments: {
          where: { supersededAt: null, status: { not: 'PAID' } },
          orderBy: { number: 'asc' },
        },
      },
    });
    if (!loan) throw new NotFoundException('No such loan');
    // Their own wallet must be linked; another number is checked by its owner's PIN.
    if (!payer && !loan.borrower.momoLinked)
      throw new ConflictException('No MoMo wallet is linked to this account');
    const next = loan.instalments[0];
    const toPay = amount ?? (next ? instalmentRemaining(next) : 0n);
    if (toPay <= 0n) throw new BadRequestException('Nothing is due');
    return this.money.requestPayment(
      code,
      toPay,
      { borrowerId },
      meta,
      payer === loan.borrower.phone ? undefined : payer,
    );
  }

  async paymentStatus(borrowerId: string, paymentId: string) {
    const p = await this.prisma.payment.findFirst({ where: { id: paymentId, borrowerId } });
    if (!p) throw new NotFoundException('No such payment');
    const status = p.status === 'PENDING' ? await this.money.settlePayment(p.id) : p.status;
    return {
      status,
      failureReason:
        status === 'FAILED'
          ? (await this.prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).failureReason
          : null,
    };
  }

  /** Products and the borrower's own pre-approved limit, for step 1 of the apply flow. */
  async applyOptions(borrowerId: string) {
    const [b, products] = await Promise.all([
      this.prisma.borrower.findUniqueOrThrow({
        where: { id: borrowerId },
        include: {
          business: true,
          offers: {
            where: { acceptedAt: null, dismissedAt: null },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      this.prisma.product.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    ]);
    return {
      products: products.map((p) => ({
        code: p.code,
        name: p.name,
        kind: p.kind,
        annualRateBps: p.annualRateBps,
        feeBps: p.originationFeeBps,
        minAmount: p.minAmount,
        maxAmount: p.maxAmount,
        terms: [6, 12, 18, 24, 36].filter((t) => t >= p.minTermMonths && t <= p.maxTermMonths),
      })),
      preApprovedLimit: b.preApprovedLimit,
      purposes: PURPOSES,
      prefill: {
        businessName: b.business?.name ?? null,
        sector: b.business?.sector ?? null,
        monthlyRevenue: b.business?.avgMonthlyRevenue ?? b.monthlyIncome,
        nationalIdMasked: b.nationalIdLast3
          ? maskNationalId(`0000000000000${b.nationalIdLast3}`)
          : null,
        kycVerified: b.kycStatus === 'VERIFIED',
      },
      wallet: b.momoLinked ? `MTN MoMo · ${maskPhone(b.phone).replace('+250 ', '0')}` : null,
    };
  }

  /** The figures for step 1, with the same calculator the console uses. */
  quote(amount: bigint, termMonths: number, annualRateBps: number, feeBps = 0) {
    const today = kigaliDate();
    const s = buildSchedule({
      principal: amount,
      annualRateBps,
      termMonths,
      firstDueDate: addMonths(today, 1),
    });
    const cost = costOfCredit({ principal: amount, annualRateBps, termMonths, feeBps });
    return {
      monthly: s.instalment,
      totalInterest: s.totalInterest,
      totalToRepay: s.totalPayable,
      firstPayment: s.rows[0]!.dueDate,
      // The fee comes out of the payout, so the borrower sees what lands in their wallet.
      fee: cost.fee,
      youReceive: cost.netDisbursed,
      totalCost: cost.totalCost,
      aprBps: cost.aprBps,
    };
  }

  /** Step 3: create the application, with consent records, from the app. */
  async apply(borrowerId: string, input: ApplyInput, meta: RequestMeta) {
    if (!input.agreedTerms)
      throw new BadRequestException('You need to agree to the loan terms to continue');
    if (input.agreementVersion !== AGREEMENT_VERSION)
      throw new ConflictException('The loan agreement has changed. Please read it again.');
    if (!PURPOSES.includes(input.purpose))
      throw new BadRequestException('Choose what the loan is for');
    const product = await this.prisma.product.findFirst({
      where: { code: input.productCode, isActive: true },
    });
    if (!product) throw new BadRequestException('Choose a product');
    if (input.amount < product.minAmount || input.amount > product.maxAmount)
      throw new BadRequestException(
        `${product.name} lends between ${formatRwf(product.minAmount)} and ${formatRwf(product.maxAmount)}`,
      );
    if (input.termMonths < product.minTermMonths || input.termMonths > product.maxTermMonths)
      throw new BadRequestException(
        `${product.name} runs for ${product.minTermMonths} to ${product.maxTermMonths} months`,
      );
    const b = await this.prisma.borrower.findUniqueOrThrow({
      where: { id: borrowerId },
      include: {
        business: true,
        applications: {
          where: { stage: { in: ['NEW', 'UNDER_REVIEW', 'CREDIT_CHECK', 'APPROVED'] } },
          select: { code: true },
        },
      },
    });
    if (b.applications.length)
      throw new ConflictException(
        `Your application ${b.applications[0]!.code} is still being reviewed`,
      );
    for (const key of [input.idPhotoKey, input.selfieKey]) {
      if (key && !this.documents.ownsKey(b.id, key))
        throw new BadRequestException('Upload your photos again');
    }

    const code = await this.prisma.$transaction(async (tx) => {
      // An ID number typed in the app is stored encrypted, like one entered by staff.
      if (input.nationalId && /^\d{16}$/.test(input.nationalId) && !b.nationalIdHash) {
        // One ID number belongs to one customer. Say so rather than fail.
        const taken = await tx.borrower.findUnique({
          where: { nationalIdHash: this.crypto.lookupHash(input.nationalId) },
          select: { id: true },
        });
        if (taken && taken.id !== b.id) {
          throw new ConflictException(
            'That ID number is already registered to another customer. Please visit a branch.',
          );
        }
        await tx.borrower.update({
          where: { id: b.id },
          data: {
            nationalIdEnc: this.crypto.encrypt(input.nationalId),
            nationalIdHash: this.crypto.lookupHash(input.nationalId),
            nationalIdLast3: input.nationalId.slice(-3),
          },
        });
      }
      if (input.businessName) {
        await tx.business.upsert({
          where: { borrowerId: b.id },
          update: {
            name: input.businessName,
            sector: input.businessSector ?? b.business?.sector,
            avgMonthlyRevenue: input.monthlyRevenue ?? b.business?.avgMonthlyRevenue,
          },
          create: {
            borrowerId: b.id,
            name: input.businessName,
            sector: input.businessSector,
            avgMonthlyRevenue: input.monthlyRevenue,
          },
        });
      }
      const app = await tx.application.create({
        data: {
          code: await nextApplicationCode(tx),
          borrowerId: b.id,
          productId: product.id,
          amount: input.amount,
          termMonths: input.termMonths,
          annualRateBps: product.annualRateBps,
          purpose: input.purpose,
          channel: 'APP',
          stage: 'NEW',
          statedMonthlyIncome: input.monthlyRevenue ?? null,
          businessName: input.businessName ?? null,
          businessSector: input.businessSector ?? null,
          // Filled in from the borrower's documents once they are attached below.
          docsRequired: product.requiredDocuments.length,
          officerId: b.officerId,
          branchId: b.branchId,
        },
      });
      const docs: Array<{ type: KycDocumentType; key: string }> = [];
      if (input.idPhotoKey) docs.push({ type: 'NATIONAL_ID', key: input.idPhotoKey });
      if (input.selfieKey) docs.push({ type: 'SELFIE', key: input.selfieKey });
      for (const d of docs) {
        // A fresh photo replaces any earlier one of the same type.
        await tx.kycDocument.updateMany({
          where: { borrowerId: b.id, type: d.type, supersededAt: null },
          data: { supersededAt: new Date() },
        });
        await tx.kycDocument.create({
          data: {
            borrowerId: b.id,
            type: d.type,
            storageKey: d.key,
            mimeType: mimeOfKey(d.key),
            applicationId: app.id,
            status: 'PENDING',
          },
        });
      }
      const consents: Array<Prisma.ConsentCreateManyInput> = [
        {
          borrowerId: b.id,
          applicationId: app.id,
          type: 'TERMS',
          textVersion: input.consentVersion,
          channel: 'APP',
          ip: meta.ip ?? null,
        },
        {
          borrowerId: b.id,
          applicationId: app.id,
          type: 'DATA_PROCESSING',
          textVersion: input.consentVersion,
          channel: 'APP',
          ip: meta.ip ?? null,
        },
      ];
      if (input.agreedBureau)
        consents.push({
          borrowerId: b.id,
          applicationId: app.id,
          type: 'CREDIT_BUREAU',
          textVersion: input.consentVersion,
          channel: 'APP',
          ip: meta.ip ?? null,
        });
      if (input.shareMomoHistory)
        consents.push({
          borrowerId: b.id,
          applicationId: app.id,
          type: 'MOMO_HISTORY',
          textVersion: input.consentVersion,
          channel: 'APP',
          ip: meta.ip ?? null,
        });
      await tx.consent.createMany({ data: consents });
      // The borrower accepted the Key Facts and agreement for exactly these terms.
      await this.agreements.record(tx, { applicationId: app.id, channel: 'APP', meta });
      // Statements are waived by MoMo consent, so count documents after consents exist.
      await this.documents.syncApplication(b.id, tx);
      await tx.loanOffer.updateMany({
        where: { borrowerId: b.id, acceptedAt: null, dismissedAt: null },
        data: { acceptedAt: new Date() },
      });
      // To the customer's officer; a customer with none yet goes to the branch managers.
      const recipients = b.officerId
        ? [b.officerId]
        : (
            await tx.user.findMany({
              where: { branchId: b.branchId ?? undefined, role: 'MANAGER', isActive: true },
              select: { id: true },
            })
          ).map((u) => u.id);
      const title = `${b.fullName} applied for ${formatRwf(input.amount)} in the app${
        b.officerId ? '' : ' and needs an officer'
      }`;
      const href = `/applications?open=${app.code}`;
      await tx.notification.createMany({
        data: recipients.length
          ? recipients.map((userId) => ({ userId, kind: 'SYSTEM' as const, title, href }))
          : [{ kind: 'SYSTEM' as const, title, href }],
      });
      await this.audit.record(
        {
          action: 'application.create',
          actorType: 'BORROWER',
          actorId: b.id,
          entityType: 'Application',
          entityId: app.code,
          metadata: {
            channel: 'APP',
            product: product.code,
            amount: input.amount,
            consents: consents.map((c) => c.type),
          },
          ...meta,
        },
        tx,
      );
      return app.code;
    });
    await this.scoring.scoreApplication(code).catch(() => null);
    await this.sms.send({
      toPhone: b.phone,
      borrowerId: b.id,
      body: `Kora Lend: we received your application ${code} for ${formatRwf(input.amount)}. We will text you as soon as there is a decision.`,
    });
    return { code, status: 'In review', expected: 'Within 1 working day' };
  }

  /** Whether an amount and term would pass the affordability rule, for the app to warn early. */
  async affordability(
    borrowerId: string,
    amount: bigint,
    termMonths: number,
    annualRateBps: number,
    limitBps: number,
  ) {
    const b = await this.prisma.borrower.findUniqueOrThrow({
      where: { id: borrowerId },
      include: { loans: { where: { status: 'ACTIVE' }, select: { instalmentAmount: true } } },
    });
    if (!b.monthlyIncome) return null;
    const check = checkAffordability({
      monthlyIncome: b.monthlyIncome,
      newInstalment: calcInstalment(amount, annualRateBps, termMonths),
      existingInstalments: b.loans.reduce((s, l) => s + l.instalmentAmount, 0n),
      limitBps,
    });
    return {
      affordable: check.affordable,
      ratio: formatBps(check.ratioBps, 0),
      limit: formatBps(limitBps, 0),
    };
  }

  /** Payments received on one loan, newest first, for the Statement screen. */
  async statement(borrowerId: string, code: string) {
    const loan = await this.prisma.loan.findFirst({
      where: { code, borrowerId },
      include: {
        product: { select: { name: true } },
        payments: {
          where: { status: 'SUCCESSFUL' },
          orderBy: { confirmedAt: 'desc' },
          include: { ledgerTransaction: { select: { memo: true } } },
        },
        instalments: { where: { supersededAt: null } },
      },
    });
    if (!loan) throw new NotFoundException('No such loan');
    return {
      code: loan.code,
      productName: loan.product.name,
      principal: loan.principal,
      disbursedOn: loan.disbursedOn ? utcDateToIso(loan.disbursedOn) : null,
      totalPaid: loan.payments.reduce((sum, p) => sum + p.amount, 0n),
      leftToPay: loan.instalments.reduce((sum, i) => sum + instalmentRemaining(i), 0n),
      payments: loan.payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        channel: PAYMENT_CHANNEL_LABELS[p.channel],
        receivedOn: kigaliDate(p.confirmedAt ?? p.initiatedAt),
        note: p.ledgerTransaction?.memo ?? 'Payment',
        reference: p.externalRef,
      })),
    };
  }

  /** The borrower's own repayment record, for the Insights tab. */
  async insights(borrowerId: string) {
    const today = kigaliDate();
    const b = await this.prisma.borrower.findUniqueOrThrow({
      where: { id: borrowerId },
      include: {
        loans: { include: { instalments: { where: { supersededAt: null } } } },
        payments: { where: { status: 'SUCCESSFUL' }, select: { amount: true, confirmedAt: true } },
      },
    });
    const all = b.loans.flatMap((l) => l.instalments);
    const paid = all.filter((i) => i.status === 'PAID' && i.paidAt);
    const onTime = paid.filter((i) => kigaliDate(i.paidAt!) <= utcDateToIso(i.dueDate));
    const early = paid.filter((i) => kigaliDate(i.paidAt!) < utcDateToIso(i.dueDate));
    const overdue = all.filter((i) => i.status !== 'PAID' && utcDateToIso(i.dueDate) < today);
    const yearStart = `${today.slice(0, 4)}-01-01`;
    // Payments by month for the last six months, oldest first.
    const months: Array<{ month: string; amount: bigint }> = [];
    for (let m = 5; m >= 0; m--) {
      const start = addMonths(`${today.slice(0, 7)}-01`, -m);
      const end = addMonths(start, 1);
      const amount = b.payments
        .filter(
          (p) =>
            p.confirmedAt && kigaliDate(p.confirmedAt) >= start && kigaliDate(p.confirmedAt) < end,
        )
        .reduce((sum, p) => sum + p.amount, 0n);
      months.push({ month: start, amount });
    }
    return {
      instalmentsPaid: paid.length,
      paidOnTime: onTime.length,
      paidEarly: early.length,
      overdueNow: overdue.length,
      onTimeRatePct: paid.length ? Math.round((onTime.length / paid.length) * 100) : null,
      paidThisYear: b.payments
        .filter((p) => p.confirmedAt && kigaliDate(p.confirmedAt) >= yearStart)
        .reduce((sum, p) => sum + p.amount, 0n),
      paidAllTime: b.payments.reduce((sum, p) => sum + p.amount, 0n),
      loansRepaid: b.loans.filter((l) => l.status === 'REPAID').length,
      preApprovedLimit: b.preApprovedLimit,
      months,
    };
  }

  async notifications(borrowerId: string) {
    const items = await this.prisma.notification.findMany({
      where: { borrowerId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    await this.prisma.notification.updateMany({
      where: { borrowerId, readAt: null },
      data: { readAt: new Date() },
    });
    return items.map((n) => ({
      id: n.id,
      title: n.title,
      kind: n.kind,
      at: n.createdAt,
      read: n.readAt != null,
    }));
  }

  async profile(borrowerId: string) {
    const b = await this.prisma.borrower.findUniqueOrThrow({
      where: { id: borrowerId },
      include: {
        business: true,
        loans: {
          orderBy: { createdAt: 'desc' },
          include: {
            product: { select: { name: true } },
            application: { select: { agreement: { select: { id: true } } } },
          },
        },
        consents: { where: { revokedAt: null }, orderBy: { grantedAt: 'desc' } },
      },
    });
    return {
      code: b.code,
      name: b.fullName,
      phone: maskPhone(b.phone),
      nationalId: b.nationalIdLast3 ? maskNationalId(`0000000000000${b.nationalIdLast3}`) : null,
      kycStatus: b.kycStatus,
      business: b.business ? { name: b.business.name, sector: b.business.sector } : null,
      language: b.preferredLanguage,
      loans: b.loans.map((l) => ({
        code: l.code,
        productName: l.product.name,
        principal: l.principal,
        status: l.status,
        disbursedOn: l.disbursedOn ? utcDateToIso(l.disbursedOn) : null,
        hasAgreement: Boolean(l.application?.agreement),
      })),
      consents: b.consents.map((c) => ({ type: c.type, grantedAt: c.grantedAt })),
    };
  }

  async withdrawConsent(
    borrowerId: string,
    type: 'MOMO_HISTORY' | 'MARKETING_SMS',
    meta: RequestMeta,
  ) {
    await this.prisma.consent.updateMany({
      where: { borrowerId, type, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      action: 'borrower.consent.withdraw',
      actorType: 'BORROWER',
      actorId: borrowerId,
      metadata: { type },
      ...meta,
    });
  }
}
