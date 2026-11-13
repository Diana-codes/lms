import {
  BadRequestException,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { addDays, formatRwf, isoToUtcDate, kigaliDate } from '@kora/core';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { requestMeta } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';

const borrowerCode = new ZodPipe(z.string().regex(/^BR-\d{5,9}$/));

/** "Offer top-up" on the borrower profile: a pre-approved offer in the app and by SMS. */
@Controller('borrowers')
export class OffersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly audit: AuditService,
  ) {}

  @Roles('LOAN_OFFICER', 'MANAGER', 'ADMIN')
  @Post(':code/offers')
  @HttpCode(201)
  async offer(
    @Param('code', borrowerCode) code: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const b = await this.prisma.borrower.findUnique({
      where: { code },
      include: {
        loans: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { product: true },
        },
        offers: {
          where: {
            acceptedAt: null,
            dismissedAt: null,
            expiresOn: { gte: isoToUtcDate(kigaliDate()) },
          },
        },
      },
    });
    if (!b) throw new NotFoundException(`No borrower ${code}`);
    if (!b.preApprovedLimit)
      throw new BadRequestException('This borrower has no pre-approved limit yet');
    if (b.offers.length)
      throw new BadRequestException('An offer is already open for this borrower');
    const product =
      b.loans[0]?.product ??
      (await this.prisma.product.findFirstOrThrow({ where: { isActive: true, kind: 'SME' } }));
    const offer = await this.prisma.loanOffer.create({
      data: {
        borrowerId: b.id,
        productId: product.id,
        maxAmount: b.preApprovedLimit,
        termMonths: Math.min(18, product.maxTermMonths),
        createdById: user.id,
        expiresOn: isoToUtcDate(addDays(kigaliDate(), 30)),
      },
    });
    await this.prisma.notification.create({
      data: {
        borrowerId: b.id,
        kind: 'SYSTEM',
        title: `You are pre-approved for up to ${formatRwf(b.preApprovedLimit)}`,
        href: `offer:${offer.id}`,
      },
    });
    const firstName = b.type === 'BUSINESS' ? b.fullName : b.fullName.split(' ')[0];
    await this.sms.send({
      toPhone: b.phone,
      borrowerId: b.id,
      sentById: user.id,
      body: `Hello ${firstName}, this is Kora Lend. You are pre-approved for a top-up of up to ${formatRwf(b.preApprovedLimit)}. Open the Kora Lend app to apply in 5 minutes.`,
    });
    await this.audit.record({
      action: 'borrower.offer.send',
      actorId: user.id,
      entityType: 'Borrower',
      entityId: code,
      metadata: { offerId: offer.id, maxAmount: b.preApprovedLimit },
      ...meta(req),
    });
    return { id: offer.id, maxAmount: offer.maxAmount, expiresOn: addDays(kigaliDate(), 30) };
  }
}
const meta = requestMeta;
