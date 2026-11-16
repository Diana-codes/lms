import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CASHFLOW_CATEGORIES, LENDING_ROLES, OVERSIGHT_ROLES } from '@kora/core';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { requestMeta, rwfString } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { CASHFLOW_MAX_BYTES, CashflowService } from './cashflow.service';

const appCode = new ZodPipe(z.string().regex(/^APP-\d+$/, 'Not an application number'));
const idParam = new ZodPipe(z.uuid());
const kindSchema = z.object({ kind: z.enum(['PAYSLIP', 'BANK_STATEMENT', 'MOMO_STATEMENT']) });

/**
 * PRD §6.15, staff side only. Borrowers never see the analysis. Credit
 * analysts, loan officers, managers and admins work with it.
 */
@Controller()
export class CashflowController {
  constructor(private readonly cashflow: CashflowService) {}

  @Roles(...LENDING_ROLES, 'AUDITOR')
  @Get('applications/:code/cashflow')
  view(@Param('code', appCode) code: string) {
    return this.cashflow.view(code);
  }

  @Roles(...LENDING_ROLES)
  @Post('applications/:code/cashflow/consent')
  consent(
    @Param('code', appCode) code: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.cashflow.recordConsent(code, user, requestMeta(req));
  }

  /** Multipart: `file` and `kind`. */
  @Roles(...LENDING_ROLES)
  @Post('applications/:code/cashflow/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: CASHFLOW_MAX_BYTES, files: 1 } }))
  upload(
    @Param('code', appCode) code: string,
    @UploadedFile()
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
    @Body(new ZodPipe(kindSchema)) body: z.infer<typeof kindSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Attach the document');
    return this.cashflow.upload(code, body.kind, file, user, requestMeta(req));
  }

  @Roles(...LENDING_ROLES)
  @Post('applications/:code/cashflow/analyse')
  @HttpCode(200)
  analyse(
    @Param('code', appCode) code: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.cashflow.analyse(code, user, requestMeta(req));
  }

  @Roles(...LENDING_ROLES)
  @Patch('cashflow/transactions/:id')
  correct(
    @Param('id', idParam) id: string,
    @Body(
      new ZodPipe(
        z.object({
          category: z.enum(CASHFLOW_CATEGORIES),
          reason: z.string().trim().min(3, 'Say why').max(300),
        }),
      ),
    )
    body: { category: (typeof CASHFLOW_CATEGORIES)[number]; reason: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.cashflow.correct(id, body.category, body.reason, user, requestMeta(req));
  }

  @Roles(...LENDING_ROLES)
  @Post('cashflow/flags/:id')
  @HttpCode(200)
  decideFlag(
    @Param('id', idParam) id: string,
    @Body(
      new ZodPipe(
        z.object({
          outcome: z.enum(['DISMISSED', 'CONFIRMED']),
          note: z.string().trim().min(3, 'Add a short note').max(300),
        }),
      ),
    )
    body: { outcome: 'DISMISSED' | 'CONFIRMED'; note: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.cashflow.decideFlag(id, body.outcome, body.note, user, requestMeta(req));
  }

  @Roles(...LENDING_ROLES)
  @Post('cashflow/analyses/:id/review')
  @HttpCode(200)
  review(
    @Param('id', idParam) id: string,
    @Body(
      new ZodPipe(
        z.object({ confirmedIncome: rwfString, note: z.string().trim().max(500).default('') }),
      ),
    )
    body: { confirmedIncome: bigint; note: string },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.cashflow.review(id, body.confirmedIncome, body.note, user, requestMeta(req));
  }

  @Roles(...OVERSIGHT_ROLES)
  @Get('cashflow/pilot')
  pilot() {
    return this.cashflow.pilot();
  }
}
