import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { requestMeta, rwfString } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { AgreementsService } from '../agreements/agreements.service';
import { ApplicationsService } from './applications.service';

const codeParam = new ZodPipe(z.string().regex(/^APP-\d{1,9}$/, 'Not an application reference'));

const createSchema = z.object({
  name: z.string().trim().min(2, 'Add a name').max(120),
  phone: z.string().trim().min(9, 'Add a phone number').max(20),
  productCode: z.string().min(1).max(30),
  amount: rwfString,
  termMonths: z.number().int().min(1).max(360).optional(),
});
const moveSchema = z.object({
  to: z.enum(['UNDER_REVIEW', 'CREDIT_CHECK', 'DECLINED', 'WITHDRAWN']),
  reason: z.string().trim().max(500).optional(),
});
const approveSchema = z
  .object({ overrideReason: z.string().trim().max(300).optional() })
  .optional();
const disburseSchema = z.object({
  channel: z.enum(['MTN_MOMO', 'AIRTEL_MONEY', 'BANK_TRANSFER', 'CASH']),
  collateral: z.string().trim().max(120).optional(),
  externalRef: z.string().trim().max(60).optional(),
});

@Controller('applications')
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly agreements: AgreementsService,
  ) {}

  @Get()
  pipeline() {
    return this.applications.pipeline();
  }

  @Get('open-count')
  async openCount() {
    return { open: await this.applications.openCount() };
  }

  @Get(':code')
  get(@Param('code', codeParam) code: string) {
    return this.applications.get(code);
  }

  @Roles('LOAN_OFFICER', 'MANAGER', 'ADMIN')
  @Post()
  create(
    @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.applications.create(body, user, requestMeta(req));
  }

  @Roles('LOAN_OFFICER', 'MANAGER', 'ADMIN')
  @Post(':code/move')
  @HttpCode(200)
  move(
    @Param('code', codeParam) code: string,
    @Body(new ZodPipe(moveSchema)) body: z.infer<typeof moveSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.applications.move(code, body.to, body.reason, user, requestMeta(req));
  }

  @Roles('LOAN_OFFICER', 'MANAGER', 'ADMIN')
  @Post(':code/approve')
  @HttpCode(200)
  approve(
    @Param('code', codeParam) code: string,
    @Body(new ZodPipe(approveSchema)) body: z.infer<typeof approveSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.applications.approve(code, user, requestMeta(req), {
      overrideReason: body?.overrideReason,
    });
  }

  @Roles('LOAN_OFFICER', 'MANAGER', 'ADMIN')
  @Post(':code/score')
  @HttpCode(200)
  rescore(
    @Param('code', codeParam) code: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.applications.rescore(code, user, requestMeta(req));
  }

  @Roles('LOAN_OFFICER', 'MANAGER', 'ADMIN')
  @Post('auto-approve')
  @HttpCode(200)
  approveEligible(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.applications.approveEligible(user, requestMeta(req));
  }

  // Sending money out is a manager's action.
  @Roles('MANAGER', 'ADMIN')
  @Post(':code/disburse')
  @HttpCode(200)
  disburse(
    @Param('code', codeParam) code: string,
    @Body(new ZodPipe(disburseSchema)) body: z.infer<typeof disburseSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.applications.disburse(code, body, user, requestMeta(req));
  }

  /** The agreement as a PDF: the signed copy, or one to print and sign. */
  @Roles('LOAN_OFFICER', 'MANAGER', 'ADMIN')
  @Get(':code/agreement.pdf')
  async agreementPdf(
    @Param('code', codeParam) code: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { pdf, fileName } = await this.agreements.pdfForApplication(code, user, requestMeta(req));
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(pdf);
  }

  /** The borrower signed the printed agreement at a branch. */
  @Roles('LOAN_OFFICER', 'MANAGER', 'ADMIN')
  @Post(':code/agreement')
  @HttpCode(200)
  signAgreement(
    @Param('code', codeParam) code: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.agreements.signAtBranch(code, user, requestMeta(req));
  }
}
