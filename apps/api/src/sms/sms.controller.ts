import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { requestMeta } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { SMS_MAX_LENGTH, SmsService } from './sms.service';

const borrowerCode = new ZodPipe(z.string().regex(/^BR-\d{5,9}$/, 'Not a borrower reference'));
const sendSchema = z.object({
  body: z.string().trim().min(1, 'Write a message first').max(SMS_MAX_LENGTH),
  loanCode: z
    .string()
    .regex(/^LN-\d{4}-\d{4}$/)
    .optional(),
  language: z.enum(['EN', 'RW', 'FR']).optional(),
});
const remindersSchema = z.object({ days: z.number().int().min(0).max(14).default(7) });

@Controller()
export class SmsController {
  constructor(private readonly sms: SmsService) {}

  @Post('borrowers/:code/sms')
  send(
    @Param('code', borrowerCode) code: string,
    @Body(new ZodPipe(sendSchema)) body: z.infer<typeof sendSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.sms.sendToBorrower(code, body, user, requestMeta(req));
  }

  /** "Send SMS reminders" on the Overview: everyone due in the next few days. */
  @Post('sms/reminders')
  @HttpCode(200)
  reminders(
    @Body(new ZodPipe(remindersSchema)) body: z.infer<typeof remindersSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sms.sendDueReminders({
      days: body.days,
      officerId: user.role === 'LOAN_OFFICER' ? user.id : null,
      sentById: user.id,
    });
  }
}
