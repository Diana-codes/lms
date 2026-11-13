import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { isoDateString, requestMeta, rwfString } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { CollectionsService } from './collections.service';

const loanCode = new ZodPipe(z.string().regex(/^LN-\d{4}-\d{4}$/, 'Not a loan reference'));
const outcomeSchema = z.object({
  outcome: z.enum(['PROMISED_TO_PAY', 'NO_ANSWER', 'PAID_PART', 'DISPUTED', 'REACHED']),
  channel: z.enum(['CALL', 'VISIT']).default('CALL'),
  date: isoDateString.optional(),
  amount: rwfString.optional(),
  note: z.string().trim().max(500).optional(),
});
const bulkSchema = z.object({ bucket: z.enum(['ALL', 'DPD_1_30', 'DPD_31_90', 'DPD_90_PLUS']) });

@Controller('collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  queue(@CurrentUser() user: AuthUser) {
    return this.collections.queue(user);
  }

  @Get('accounts/:code')
  account(@Param('code', loanCode) code: string) {
    return this.collections.account(code);
  }

  @Get('accounts/:code/drafts')
  drafts(@Param('code', loanCode) code: string) {
    return this.collections.drafts(code);
  }

  @Post('accounts/:code/outcome')
  @HttpCode(200)
  outcome(
    @Param('code', loanCode) code: string,
    @Body(new ZodPipe(outcomeSchema)) body: z.infer<typeof outcomeSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.collections.logOutcome(code, body, user, requestMeta(req));
  }

  @Post('bulk-sms')
  @HttpCode(200)
  bulkSms(
    @Body(new ZodPipe(bulkSchema)) body: z.infer<typeof bulkSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.collections.bulkSms(body.bucket, user, requestMeta(req));
  }

  @Roles('MANAGER', 'ADMIN')
  @Post('assign')
  @HttpCode(200)
  assign(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.collections.assign(user, requestMeta(req));
  }
}
