import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import {
  COLLATERAL_KINDS,
  DPD_BUCKETS,
  LENDING_ROLES,
  OVERSIGHT_ROLES,
  PAYMENT_ROLES,
} from '@kora/core';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { isoDateString, pageQuery, requestMeta, rwfString } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { LoanSecurityService } from './loan-security.service';
import { LoansService } from './loans.service';
import { WriteOffService } from './write-off.service';

const codeParam = new ZodPipe(z.string().regex(/^LN-\d{4}-\d{4}$/, 'Not a loan reference'));
const idParam = new ZodPipe(z.uuid());

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
const waiveSchema = z.object({
  reason: z.string().trim().min(5, 'Say why the late charges are waived').max(300),
  /** Leave out to waive every late charge still owed. */
  amount: rwfString.optional(),
});
const restructureSchema = z.object({
  type: z.enum(['EXTEND_TERM', 'PAYMENT_HOLIDAY']),
  newTermMonths: z.number().int().min(1).max(360).optional(),
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});
const decideSchema = z.object({ approve: z.boolean() });
const writeOffSchema = z.object({
  reason: z.string().trim().min(10, 'Explain why, in a sentence').max(500),
});
const recoverySchema = z.object({
  amount: rwfString,
  channel: z.enum(['MTN_MOMO', 'AIRTEL_MONEY', 'BANK_TRANSFER', 'CASH']),
  receivedOn: isoDateString,
  reference: z.string().trim().max(60).optional(),
  idempotencyKey: z.uuid(),
});
/** Market value may be zero for descriptive-only (OTHER) security. */
const marketValueSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^RWF\s*/i, '').replace(/[,\s]/g, ''))
  .pipe(z.string().regex(/^\d{1,15}$/, 'Enter a whole amount in RWF'))
  .transform((v) => BigInt(v))
  .refine((v) => v >= 0n, 'Market value cannot be negative');

const collateralSchema = z.object({
  kind: z.enum(COLLATERAL_KINDS),
  description: z.string().trim().min(2).max(200),
  marketValue: marketValueSchema,
  registered: z.boolean().optional(),
  insured: z.boolean().optional(),
  valuedOn: isoDateString.optional(),
  valuerName: z.string().trim().max(120).nullable().optional(),
  documentRef: z.string().trim().max(80).nullable().optional(),
});
const guarantorSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).nullable().optional(),
  nationalIdLast3: z
    .string()
    .trim()
    .regex(/^\d{3}$/, 'Use the last 3 digits')
    .nullable()
    .optional(),
  relationship: z.string().trim().max(60).nullable().optional(),
  guaranteeAmount: rwfString.nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

@Controller()
export class LoansController {
  constructor(
    private readonly loans: LoansService,
    private readonly security: LoanSecurityService,
    private readonly writeOffs: WriteOffService,
  ) {}

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

  /** The Key Facts Statement the loan was issued under. */
  @Get('loans/:code/key-facts')
  keyFacts(@Param('code', codeParam) code: string) {
    return this.loans.keyFacts(code);
  }

  @Roles(...PAYMENT_ROLES)
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

  @Roles(...LENDING_ROLES)
  @Post('loans/:code/collateral')
  addCollateral(
    @Param('code', codeParam) code: string,
    @Body(new ZodPipe(collateralSchema)) body: z.infer<typeof collateralSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.security.addCollateral(
      code,
      {
        ...body,
        marketValue: body.marketValue,
        valuedOn: body.valuedOn,
      },
      user,
      requestMeta(req),
    );
  }

  @Roles(...LENDING_ROLES)
  @Post('loans/:code/collateral/:id/release')
  @HttpCode(200)
  releaseCollateral(
    @Param('code', codeParam) code: string,
    @Param('id', idParam) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.security.releaseCollateral(code, id, user, requestMeta(req));
  }

  @Roles(...LENDING_ROLES)
  @Post('loans/:code/guarantors')
  addGuarantor(
    @Param('code', codeParam) code: string,
    @Body(new ZodPipe(guarantorSchema)) body: z.infer<typeof guarantorSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.security.addGuarantor(
      code,
      {
        ...body,
        guaranteeAmount: body.guaranteeAmount ?? null,
      },
      user,
      requestMeta(req),
    );
  }

  @Roles(...LENDING_ROLES)
  @Post('loans/:code/guarantors/:id/release')
  @HttpCode(200)
  releaseGuarantor(
    @Param('code', codeParam) code: string,
    @Param('id', idParam) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.security.releaseGuarantor(code, id, user, requestMeta(req));
  }

  // ── write-offs and recoveries (PRD §6.13) ──

  @Get('loans/:code/write-offs')
  async loanWriteOffs(@Param('code', codeParam) code: string) {
    const { id } = await this.loans.idFor(code);
    return this.writeOffs.forLoan(id);
  }

  @Roles(...OVERSIGHT_ROLES)
  @Get('write-offs')
  listWriteOffs(
    @Query('status', new ZodPipe(z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional()))
    status?: 'PENDING' | 'APPROVED' | 'REJECTED',
  ) {
    return this.writeOffs.list(status);
  }

  @Roles('MANAGER', 'ADMIN', 'COLLECTIONS_AGENT')
  @Post('loans/:code/write-off')
  requestWriteOff(
    @Param('code', codeParam) code: string,
    @Body(new ZodPipe(writeOffSchema)) body: z.infer<typeof writeOffSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.writeOffs.request(code, body.reason, user, requestMeta(req));
  }

  @Roles('MANAGER', 'ADMIN')
  @Post('write-offs/:id/decide')
  @HttpCode(200)
  decideWriteOff(
    @Param('id', new ZodPipe(z.uuid())) id: string,
    @Body(new ZodPipe(decideSchema)) body: z.infer<typeof decideSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.writeOffs.decide(id, body.approve, user, requestMeta(req));
  }

  // Waiving income is a manager's decision, and it is audited.
  @Roles('MANAGER', 'ADMIN')
  @Post('loans/:code/late-charges/waive')
  @HttpCode(200)
  async waiveLateCharges(
    @Param('code', codeParam) code: string,
    @Body(new ZodPipe(waiveSchema)) body: z.infer<typeof waiveSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    await this.loans.waiveLateCharges(code, body, user, requestMeta(req));
    return this.loans.detail(code);
  }

  @Roles(...PAYMENT_ROLES)
  @Post('loans/:code/recoveries')
  @HttpCode(200)
  recordRecovery(
    @Param('code', codeParam) code: string,
    @Body(new ZodPipe(recoverySchema)) body: z.infer<typeof recoverySchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.writeOffs.recordRecovery(code, body, user, requestMeta(req));
  }
}
