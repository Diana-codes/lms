import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../auth/decorators';
import { requestMeta, rwfString } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { BorrowerAppService } from './borrower-app.service';
import { BorrowerAuthService } from './borrower-auth.service';
import { BorrowerGuard, type BorrowerPrincipal } from './borrower.guard';
import { UPLOAD_MAX_BYTES, UploadsService } from './uploads.service';

type BorrowerRequest = Request & { borrower: BorrowerPrincipal };
const loanCode = new ZodPipe(z.string().regex(/^LN-\d{4}-\d{4}$/));

const phoneSchema = z.object({ phone: z.string().trim().min(9).max(20) });
const verifySchema = phoneSchema.extend({ code: z.string().regex(/^\d{6}$/) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const paySchema = z.object({ amount: rwfString.optional() });
const quoteSchema = z.object({
  productCode: z.string().min(1),
  amount: rwfString,
  termMonths: z.coerce.number().int().min(1).max(60),
});
const applySchema = z.object({
  productCode: z.string().min(1),
  amount: rwfString,
  termMonths: z.number().int().min(1).max(60),
  purpose: z.string().trim().min(1).max(40),
  businessName: z.string().trim().max(120).optional(),
  businessSector: z.string().trim().max(60).optional(),
  monthlyRevenue: rwfString.optional(),
  nationalId: z
    .string()
    .regex(/^\d{16}$/)
    .optional(),
  shareMomoHistory: z.boolean().default(false),
  agreedTerms: z.boolean(),
  agreedBureau: z.boolean().default(false),
  consentVersion: z.string().min(1).max(20).default('2026-01'),
  idPhotoKey: z.string().max(200).optional(),
  selfieKey: z.string().max(200).optional(),
});
const consentSchema = z.object({ type: z.enum(['MOMO_HISTORY', 'MARKETING_SMS']) });

/** Everything the borrower app calls lives under /app. */
@Public()
@Controller('app')
export class BorrowerAppController {
  constructor(
    private readonly auth: BorrowerAuthService,
    private readonly app: BorrowerAppService,
    private readonly uploads: UploadsService,
  ) {}

  // ── sign-in ──
  @Post('auth/request-code')
  @HttpCode(200)
  requestCode(
    @Body(new ZodPipe(phoneSchema)) body: z.infer<typeof phoneSchema>,
    @Req() req: Request,
  ) {
    return this.auth.requestCode(body.phone, requestMeta(req));
  }

  @Post('auth/verify')
  @HttpCode(200)
  verify(@Body(new ZodPipe(verifySchema)) body: z.infer<typeof verifySchema>, @Req() req: Request) {
    return this.auth.verifyCode(body.phone, body.code, requestMeta(req));
  }

  @Post('auth/refresh')
  @HttpCode(200)
  refresh(@Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    return this.auth.refresh(body.refreshToken);
  }

  @UseGuards(BorrowerGuard)
  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: BorrowerRequest): Promise<void> {
    await this.auth.logout(req.borrower.sessionId);
  }

  // ── home, loans, payments ──
  @UseGuards(BorrowerGuard)
  @Get('home')
  home(@Req() req: BorrowerRequest) {
    return this.app.home(req.borrower.borrowerId);
  }

  @UseGuards(BorrowerGuard)
  @Get('loans/:code/schedule')
  schedule(@Req() req: BorrowerRequest, @Param('code', loanCode) code: string) {
    return this.app.schedule(req.borrower.borrowerId, code);
  }

  @UseGuards(BorrowerGuard)
  @Post('loans/:code/pay')
  @HttpCode(202)
  pay(
    @Req() req: BorrowerRequest,
    @Param('code', loanCode) code: string,
    @Body(new ZodPipe(paySchema)) body: z.infer<typeof paySchema>,
  ) {
    return this.app.pay(req.borrower.borrowerId, code, body.amount, requestMeta(req));
  }

  @UseGuards(BorrowerGuard)
  @Get('payments/:id')
  payment(@Req() req: BorrowerRequest, @Param('id', new ZodPipe(z.uuid())) id: string) {
    return this.app.paymentStatus(req.borrower.borrowerId, id);
  }

  // ── apply ──
  @UseGuards(BorrowerGuard)
  @Get('apply/options')
  options(@Req() req: BorrowerRequest) {
    return this.app.applyOptions(req.borrower.borrowerId);
  }

  @UseGuards(BorrowerGuard)
  @Get('apply/quote')
  async quote(
    @Req() req: BorrowerRequest,
    @Query(new ZodPipe(quoteSchema)) q: z.infer<typeof quoteSchema>,
  ) {
    const quote = await this.app.quote(q.productCode, q.amount, q.termMonths);
    if (!quote) return { error: 'Choose a product' };
    const { terms, ...figures } = quote;
    const affordability = await this.app.affordability(
      req.borrower.borrowerId,
      quote.instalment,
      terms.frequency,
      3500,
    );
    return { ...figures, affordability };
  }

  @UseGuards(BorrowerGuard)
  @Post('apply/upload/:kind')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 } }))
  async upload(
    @Req() req: BorrowerRequest,
    @Param('kind', new ZodPipe(z.enum(['id', 'selfie']))) kind: 'id' | 'selfie',
    @UploadedFile() file: { mimetype: string; size: number; buffer: Buffer } | undefined,
  ) {
    if (!file) return { error: 'Attach a photo' };
    return { key: await this.uploads.store(req.borrower.borrowerId, kind, file) };
  }

  @UseGuards(BorrowerGuard)
  @Post('apply')
  apply(
    @Req() req: BorrowerRequest,
    @Body(new ZodPipe(applySchema)) body: z.infer<typeof applySchema>,
  ) {
    return this.app.apply(req.borrower.borrowerId, body, requestMeta(req));
  }

  // ── profile and notifications ──
  @UseGuards(BorrowerGuard)
  @Get('notifications')
  notifications(@Req() req: BorrowerRequest) {
    return this.app.notifications(req.borrower.borrowerId);
  }

  @UseGuards(BorrowerGuard)
  @Get('profile')
  profile(@Req() req: BorrowerRequest) {
    return this.app.profile(req.borrower.borrowerId);
  }

  @UseGuards(BorrowerGuard)
  @Post('profile/consents/withdraw')
  @HttpCode(204)
  async withdraw(
    @Req() req: BorrowerRequest,
    @Body(new ZodPipe(consentSchema)) body: z.infer<typeof consentSchema>,
  ): Promise<void> {
    await this.app.withdrawConsent(req.borrower.borrowerId, body.type, requestMeta(req));
  }
}
