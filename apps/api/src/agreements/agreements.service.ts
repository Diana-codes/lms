import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { formatDate, kigaliDate, maskNationalId, maskPhone, shortStaffName } from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { agreementPdf } from './pdf';
import {
  AGREEMENT_VERSION,
  agreementTerms,
  keyFacts,
  renderAgreement,
  type AgreementParties,
  type AgreementTerms,
} from './template';

type Db = Prisma.TransactionClient | PrismaService;

/** What the terms are built from: a product and what was asked for. */
interface TermsSource {
  amount: bigint;
  termMonths: number;
  annualRateBps: number;
  product: {
    name: string;
    originationFeeBps: number;
    latePenaltyBps: number;
    penaltyGraceDays: number;
  };
}

interface PartySource {
  code: string;
  fullName: string;
  phone: string;
  nationalIdLast3: string | null;
}

/** Stages in which an agreement can still be signed. */
const SIGNABLE = ['NEW', 'UNDER_REVIEW', 'CREDIT_CHECK', 'APPROVED'];

const kigaliTime = (d: Date) =>
  d.toLocaleTimeString('en-GB', { timeZone: 'Africa/Kigali', hour: '2-digit', minute: '2-digit' });

/**
 * Loan agreements: the Key Facts shown before applying, the signed copy kept
 * word for word, and its PDF. Disbursement reads the fee and penalty terms
 * from the signed copy, so a loan always follows what the borrower agreed to.
 */
@Injectable()
export class AgreementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  terms(src: TermsSource): AgreementTerms {
    return agreementTerms({
      principal: src.amount,
      annualRateBps: src.annualRateBps,
      termMonths: src.termMonths,
      feeBps: src.product.originationFeeBps,
      latePenaltyBps: src.product.latePenaltyBps,
      penaltyGraceDays: src.product.penaltyGraceDays,
    });
  }

  parties(
    b: PartySource,
    applicationCode: string,
    productName: string,
    at = new Date(),
  ): AgreementParties {
    return {
      borrowerName: b.fullName,
      borrowerCode: b.code,
      nationalId: b.nationalIdLast3 ? maskNationalId(`0000000000000${b.nationalIdLast3}`) : null,
      phone: maskPhone(b.phone),
      applicationCode,
      productName,
      date: formatDate(kigaliDate(at)),
    };
  }

  /** What the app shows on the review step, before there is an application. */
  async preview(borrowerId: string, productCode: string, amount: bigint, termMonths: number) {
    const [b, product] = await Promise.all([
      this.prisma.borrower.findUniqueOrThrow({ where: { id: borrowerId } }),
      this.prisma.product.findFirst({ where: { code: productCode, isActive: true } }),
    ]);
    if (!product) throw new BadRequestException('Choose a product');
    const terms = this.terms({ amount, termMonths, annualRateBps: product.annualRateBps, product });
    return {
      version: AGREEMENT_VERSION,
      terms,
      keyFacts: keyFacts(terms).map(([label, value]) => ({ label, value })),
      body: renderAgreement(terms, this.parties(b, 'New application', product.name)),
    };
  }

  /**
   * Record that the borrower accepted the agreement for an application. Pass
   * the transaction that creates the application (app) or marks the paper
   * copy as signed (branch).
   */
  async record(
    tx: Prisma.TransactionClient,
    input: {
      applicationId: string;
      channel: 'APP' | 'BRANCH';
      meta: RequestMeta;
      recordedById?: string | null;
    },
  ) {
    const app = await tx.application.findUniqueOrThrow({
      where: { id: input.applicationId },
      include: { borrower: true, product: true, agreement: { select: { id: true } } },
    });
    if (app.agreement)
      throw new ConflictException('This application already has a signed agreement');
    const terms = this.terms(app);
    const body = renderAgreement(terms, this.parties(app.borrower, app.code, app.product.name));
    return tx.loanAgreement.create({
      data: {
        applicationId: app.id,
        borrowerId: app.borrowerId,
        templateVersion: AGREEMENT_VERSION,
        terms: terms as unknown as Prisma.InputJsonValue,
        body,
        bodyHash: createHash('sha256').update(body).digest('hex'),
        channel: input.channel,
        ip: input.meta.ip ?? null,
        userAgent: input.meta.userAgent?.slice(0, 300) ?? null,
        recordedById: input.recordedById ?? null,
      },
    });
  }

  /** An officer records that the borrower signed the printed agreement at a branch. */
  async signAtBranch(code: string, user: AuthUser, meta: RequestMeta) {
    const app = await this.prisma.application.findUnique({
      where: { code },
      select: { id: true, stage: true, agreement: { select: { id: true } } },
    });
    if (!app) throw new NotFoundException(`No application ${code}`);
    if (app.agreement)
      throw new ConflictException('This application already has a signed agreement');
    if (!SIGNABLE.includes(app.stage))
      throw new ConflictException('An agreement can only be signed before the loan is paid out');
    await this.prisma.$transaction(async (tx) => {
      const a = await this.record(tx, {
        applicationId: app.id,
        channel: 'BRANCH',
        meta,
        recordedById: user.id,
      });
      await this.audit.record(
        {
          action: 'agreement.sign.branch',
          actorId: user.id,
          entityType: 'Application',
          entityId: code,
          metadata: { agreementId: a.id, version: a.templateVersion, hash: a.bodyHash },
          ...meta,
        },
        tx,
      );
    });
    return this.summary(code);
  }

  /** For the application dialog: signed or not, how and when. */
  async summary(code: string, db: Db = this.prisma) {
    const app = await db.application.findUnique({
      where: { code },
      select: {
        agreement: {
          include: { recordedBy: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    const a = app?.agreement;
    if (!a) return { signed: false as const };
    return {
      signed: true as const,
      channel: a.channel,
      acceptedAt: a.acceptedAt,
      version: a.templateVersion,
      recordedBy: a.recordedBy
        ? shortStaffName(a.recordedBy.firstName, a.recordedBy.lastName)
        : null,
      terms: a.terms as unknown as AgreementTerms,
    };
  }

  /** The PDF for staff: the signed copy if there is one, otherwise a copy to print and sign. */
  async pdfForApplication(code: string, user: AuthUser, meta: RequestMeta) {
    const app = await this.prisma.application.findUnique({
      where: { code },
      include: {
        borrower: true,
        product: true,
        agreement: { include: { recordedBy: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!app) throw new NotFoundException(`No application ${code}`);
    await this.audit.record({
      action: 'agreement.pdf',
      actorId: user.id,
      entityType: 'Application',
      entityId: code,
      metadata: { signed: Boolean(app.agreement) },
      ...meta,
    });
    if (app.agreement) return this.signedPdf(app.agreement, code);
    const terms = this.terms(app);
    const body =
      renderAgreement(terms, this.parties(app.borrower, app.code, app.product.name)) +
      '\nBorrower signature: ______________________________   Date: ______________\n\n' +
      'Signed on behalf of Kora Lend: ______________________   Date: ______________\n';
    return {
      pdf: await agreementPdf(body, [
        `${code}`,
        'NOT YET SIGNED: print, sign, then record it in the console',
      ]),
      fileName: `${code}-agreement-to-sign.pdf`,
    };
  }

  /** The PDF for the borrower, by loan. Only their own. */
  async pdfForBorrower(borrowerId: string, loanCode: string) {
    const loan = await this.prisma.loan.findFirst({
      where: { code: loanCode, borrowerId },
      select: {
        application: {
          select: {
            code: true,
            agreement: { include: { recordedBy: { select: { firstName: true, lastName: true } } } },
          },
        },
      },
    });
    if (!loan) throw new NotFoundException('No such loan');
    const a = loan.application?.agreement;
    if (!a) throw new NotFoundException('There is no signed agreement on file for this loan');
    return this.signedPdf(a, loan.application!.code);
  }

  private async signedPdf(
    a: {
      body: string;
      bodyHash: string;
      channel: 'APP' | 'BRANCH';
      acceptedAt: Date;
      recordedBy: { firstName: string; lastName: string } | null;
    },
    code: string,
  ) {
    const when = `${formatDate(kigaliDate(a.acceptedAt))} ${kigaliTime(a.acceptedAt)} Kigali`;
    const how =
      a.channel === 'APP'
        ? `Accepted in the Kora Lend app on ${when}`
        : `Signed at a branch; recorded by ${a.recordedBy ? shortStaffName(a.recordedBy.firstName, a.recordedBy.lastName) : 'staff'} on ${when}`;
    return {
      pdf: await agreementPdf(a.body, [code, how, `SHA-256 ${a.bodyHash.slice(0, 16)}`]),
      fileName: `${code}-agreement.pdf`,
    };
  }
}
