import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { addDays, kigaliDate, kigaliDayStart, utcDateToIso } from '@kora/core';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { requestMeta } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { AiService } from './ai.service';
import { ScoringService } from './scoring.service';

const borrowerCode = new ZodPipe(z.string().regex(/^BR-\d{5,9}$/));
const loanCode = new ZodPipe(z.string().regex(/^LN-\d{4}-\d{4}$/));
const askSchema = z.object({
  question: z.string().trim().min(5, 'Ask a fuller question').max(300),
});
const summarySchema = z.object({ force: z.boolean().default(false) });

@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly scoring: ScoringService,
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
  ) {}

  @Get('status')
  status() {
    return this.ai.status();
  }

  @Post('borrowers/:code/summary')
  @HttpCode(200)
  summary(
    @Param('code', borrowerCode) code: string,
    @Body(new ZodPipe(summarySchema)) body: z.infer<typeof summarySchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.ai.borrowerSummary(code, user, body.force, requestMeta(req));
  }

  @Get('collections/:code/approach')
  approach(@Param('code', loanCode) code: string, @CurrentUser() user: AuthUser) {
    return this.ai.collectionsApproach(code, user);
  }

  @Roles('MANAGER', 'ADMIN')
  @Post('ask')
  @HttpCode(200)
  ask(
    @Body(new ZodPipe(askSchema)) body: z.infer<typeof askSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.ai.ask(body.question, user, requestMeta(req));
  }

  @Roles('MANAGER', 'ADMIN', 'AUDITOR')
  @Get('fairness')
  fairness() {
    return this.ai.fairness();
  }

  @Get('early-warning')
  async earlyWarning() {
    const result = await this.scoring.earlyWarning();
    if (!result) return { available: false, flagged: [], signals: [] };
    const counts = new Map<string, number>();
    for (const f of result.flagged)
      for (const s of f.signals) {
        const key = s.startsWith('MoMo inflows down')
          ? 'MoMo inflows down 30%+ this month'
          : s.replace(/^\d+ part-payments/, 'Several part-payments');
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    const sent = await this.prisma.smsMessage.count({
      where: {
        template: 'checkin',
        createdAt: { gte: kigaliDayStart(addDays(kigaliDate(), -7)) },
        loanId: { in: result.flagged.map((f) => f.loanId) },
      },
    });
    return {
      available: true,
      asOf: result.asOf,
      modelVersion: result.modelVersion,
      flagged: result.flagged.map(({ loanId: _id, ...rest }) => rest),
      signals: [...counts].sort((a, b) => b[1] - a[1]).map(([text, count]) => ({ text, count })),
      checkInsSent: sent > 0 && sent >= result.flagged.length,
    };
  }

  /** A friendly, no-pressure SMS to each flagged borrower, at most once a week. */
  @Post('early-warning/check-ins')
  @HttpCode(200)
  async checkIns(@CurrentUser() user: AuthUser) {
    const result = await this.scoring.earlyWarning();
    if (!result) return { sent: 0 };
    let sent = 0;
    for (const f of result.flagged) {
      const recent = await this.prisma.smsMessage.findFirst({
        where: {
          loanId: f.loanId,
          template: 'checkin',
          createdAt: { gte: kigaliDayStart(addDays(kigaliDate(), -7)) },
        },
      });
      if (recent) continue;
      const loan = await this.prisma.loan.findUniqueOrThrow({
        where: { id: f.loanId },
        include: {
          borrower: true,
          instalments: {
            where: { supersededAt: null, status: { not: 'PAID' } },
            orderBy: { dueDate: 'asc' },
            take: 1,
          },
        },
      });
      const next = loan.instalments[0];
      const msg = await this.sms.send({
        toPhone: loan.borrower.phone,
        borrowerId: loan.borrowerId,
        loanId: loan.id,
        template: 'checkin',
        language: loan.borrower.preferredLanguage,
        sentById: user.id,
        body: this.sms.render(
          'checkin',
          {
            firstName:
              loan.borrower.type === 'BUSINESS' ? undefined : loan.borrower.fullName.split(' ')[0],
            loanCode: loan.code,
            date: next ? utcDateToIso(next.dueDate) : undefined,
          },
          loan.borrower.preferredLanguage,
        ),
      });
      if (msg.status !== 'FAILED') sent += 1;
    }
    return { sent };
  }
}
