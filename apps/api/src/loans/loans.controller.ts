import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { DPD_BUCKETS } from '@kora/core';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { isoDateString, pageQuery, requestMeta, rwfString } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { LoansService } from './loans.service';

const codeParam = new ZodPipe(z.string().regex(/^LN-\d{4}-\d{4}$/, 'Not a loan reference'));

const listSchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['PENDING_DISBURSEMENT', 'ACTIVE', 'REPAID', 'WRITTEN_OFF']).optional(),
  bucket: z.enum(DPD_BUCKETS).optional(),
  mine: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  page: pageQuery,
});
const paymentSchema = z.object({
  amount: rwfString,
  channel: z.enum(['MTN_MOMO', 'AIRTEL_MONEY', 'BANK_TRANSFER', 'CASH']),
  receivedOn: isoDateString,
  externalRef: z.string().trim().max(60).optional(),
  idempotencyKey: z.uuid(),
});
const restructureSchema = z.object({
  type: z.enum(['EXTEND_TERM', 'PAYMENT_HOLIDAY']),
  newTermMonths: z.number().int().min(1).max(360).optional(),
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});
const decideSchema = z.object({ approve: z.boolean() });

@Controller()
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Get('loans')
  list(
    @Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.loans.list(query, user);
  }

  @Get('loans/:code')
  detail(@Param('code', codeParam) code: string) {
    return this.loans.detail(code);
  }

  @Post('loans/:code/payments')
  @HttpCode(200)
  recordPayment(
    @Param('code', codeParam) code: string,
    @Body(new ZodPipe(paymentSchema)) body: z.infer<typeof paymentSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.loans.recordPayment(code, body, user, requestMeta(req));
  }

  @Post('loans/:code/restructures')
  requestRestructure(
    @Param('code', codeParam) code: string,
    @Body(new ZodPipe(restructureSchema)) body: z.infer<typeof restructureSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.loans.requestRestructure(code, body, user, requestMeta(req));
  }

  @Roles('MANAGER', 'ADMIN')
  @Post('restructures/:id/decide')
  @HttpCode(200)
  decideRestructure(
    @Param('id', new ZodPipe(z.uuid())) id: string,
    @Body(new ZodPipe(decideSchema)) body: z.infer<typeof decideSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.loans.decideRestructure(id, body.approve, user, requestMeta(req));
  }
}
