import { Body, Controller, Get, Header, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { FINANCE_ROLES, LENDING_ROLES, OVERSIGHT_ROLES } from '@kora/core';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { isoDateString, requestMeta } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { BureauService } from './bureau.service';

const idParam = new ZodPipe(z.uuid());
const appCode = new ZodPipe(z.string().min(3).max(40));

const generateSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month'),
  lenderCode: z
    .string()
    .trim()
    .min(2, 'Enter your member code at the bureau')
    .max(20)
    .regex(/^[A-Za-z0-9_-]+$/, 'Use letters and digits only'),
});
const submitSchema = z.object({
  reference: z.string().trim().min(2, 'Enter the bureau’s upload reference').max(80),
});
const responseSchema = z.object({
  accepted: z.boolean(),
  rejectedCount: z.number().int().min(0).max(1_000_000).optional(),
  note: z.string().trim().max(1000).optional(),
});
const checkSchema = z.object({
  subject: z.enum(['BORROWER', 'GUARANTOR']),
  guarantorName: z.string().trim().max(120).optional(),
  consentNote: z.string().trim().max(200).optional(),
  bureau: z.string().trim().min(2, 'Which bureau?').max(60),
  reference: z.string().trim().max(80).optional(),
  score: z.number().int().min(0).max(1000).optional(),
  openLoans: z.number().int().min(0).max(1000).optional(),
  hasDefaults: z.boolean(),
  summary: z.string().trim().min(5, 'Summarise what the report shows').max(1000),
  checkedOn: isoDateString,
});

/** Credit bureau reporting and checks (PRD §15.6, Appendix A.11). */
@Controller()
export class BureauController {
  constructor(private readonly bureau: BureauService) {}

  @Roles(...OVERSIGHT_ROLES)
  @Get('bureau/submissions')
  async list() {
    return {
      submissions: await this.bureau.list(),
      lastLenderCode: await this.bureau.lastLenderCode(),
    };
  }

  @Roles(...OVERSIGHT_ROLES)
  @Get('bureau/submissions/:id')
  detail(@Param('id', idParam) id: string) {
    return this.bureau.detail(id);
  }

  @Roles(...FINANCE_ROLES)
  @Post('bureau/submissions')
  generate(
    @Body(new ZodPipe(generateSchema)) body: z.infer<typeof generateSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.bureau.generate(body.month, body.lenderCode, user, requestMeta(req));
  }

  /** The file holds full national IDs: only finance roles may take a copy. */
  @Roles(...FINANCE_ROLES)
  @Get('bureau/submissions/:id/file')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async file(
    @Param('id', idParam) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { content, filename } = await this.bureau.file(id, user, requestMeta(req));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return content;
  }

  @Roles(...FINANCE_ROLES)
  @Post('bureau/submissions/:id/submitted')
  @HttpCode(200)
  submitted(
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(submitSchema)) body: z.infer<typeof submitSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.bureau.markSubmitted(id, body.reference, user, requestMeta(req));
  }

  @Roles(...FINANCE_ROLES)
  @Post('bureau/submissions/:id/response')
  @HttpCode(200)
  response(
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(responseSchema)) body: z.infer<typeof responseSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.bureau.recordResponse(id, body, user, requestMeta(req));
  }

  // ── checks on an application ──

  @Get('applications/:code/bureau')
  checks(@Param('code', appCode) code: string) {
    return this.bureau.checks(code);
  }

  @Roles(...LENDING_ROLES)
  @Post('applications/:code/bureau/consent')
  @HttpCode(200)
  consent(
    @Param('code', appCode) code: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.bureau.recordConsent(code, user, requestMeta(req));
  }

  @Roles(...LENDING_ROLES)
  @Post('applications/:code/bureau/checks')
  @HttpCode(200)
  record(
    @Param('code', appCode) code: string,
    @Body(new ZodPipe(checkSchema)) body: z.infer<typeof checkSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.bureau.recordCheck(code, body, user, requestMeta(req));
  }
}
