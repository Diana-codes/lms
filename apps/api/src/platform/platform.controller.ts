import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../auth/decorators';
import { MIN_PASSWORD_LENGTH } from '../auth/password';
import { requestMeta } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { SLUG_PATTERN } from '../tenancy/companies.service';
import {
  hexColour,
  logoUrl,
  optionalText,
  secretsSchema,
} from '../tenancy/company-settings.schemas';
import { PLATFORM_COOKIE, PlatformAuthService } from './platform-auth.service';
import { AllowBeforeTwoFactor, PlatformGuard, type PlatformRequest } from './platform.guard';
import { PlatformService } from './platform.service';

const companyId = new ZodPipe(z.uuid());
const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Not a known time zone');

const loginSchema = z.object({ email: z.string().trim().min(3), password: z.string().min(1) });
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
const challengeSchema = codeSchema.extend({ challengeToken: z.string().min(20) });
const resendSchema = z.object({ challengeToken: z.string().min(20) });
const phoneSchema = z.object({ phone: z.string().trim().min(9).max(20) });

const createSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG_PATTERN, 'Use 1–40 lowercase letters, digits or hyphens'),
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().max(200).optional(),
  brandName: z.string().trim().max(60).optional(),
  timezone: timezone.optional(),
  defaultLanguage: z.enum(['EN', 'RW', 'FR']).optional(),
  aiFeatures: z.boolean().optional(),
  autoApprove: z.boolean().optional(),
  staffTwoFactor: z.boolean().optional(),
  borrowerOtp: z.boolean().optional(),
  admin: z.object({
    email: z.email(),
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
      .max(200),
  }),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    legalName: optionalText(200),
    brandName: optionalText(60),
    brandColor: hexColour.nullable().optional(),
    accentColor: hexColour.nullable().optional(),
    logoUrl: logoUrl.nullable().optional(),
    timezone: timezone.optional(),
    defaultLanguage: z.enum(['EN', 'RW', 'FR']).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    aiFeatures: z.boolean().optional(),
    autoApprove: z.boolean().optional(),
    staffTwoFactor: z.boolean().optional(),
    borrowerOtp: z.boolean().optional(),
  })
  .strict();

/**
 * Platform administration (Orin Tech House): companies, their settings and
 * usage. Not reachable with a company staff session; see PlatformGuard.
 */
@Public()
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly platform: PlatformService,
  ) {}

  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body.email, body.password, requestMeta(req));
    if (result.status === 'TWO_FACTOR_REQUIRED') return result;
    res.cookie(PLATFORM_COOKIE, result.token, this.auth.cookieOptions());
    return { status: 'OK' as const, admin: result.admin };
  }

  @Post('auth/2fa/resend')
  @HttpCode(200)
  resendCode(@Body(new ZodPipe(resendSchema)) body: z.infer<typeof resendSchema>) {
    return this.auth.resendSignInCode(body.challengeToken);
  }

  @UseGuards(PlatformGuard)
  @AllowBeforeTwoFactor()
  @Post('auth/2fa/sms/start')
  @HttpCode(200)
  startSms(
    @Body(new ZodPipe(phoneSchema)) body: z.infer<typeof phoneSchema>,
    @Req() req: PlatformRequest,
  ) {
    return this.auth.startPhoneVerification(req.platformAdmin!.id, body.phone);
  }

  @UseGuards(PlatformGuard)
  @AllowBeforeTwoFactor()
  @Post('auth/2fa/sms/confirm')
  @HttpCode(200)
  confirmSms(
    @Body(new ZodPipe(codeSchema)) body: z.infer<typeof codeSchema>,
    @Req() req: PlatformRequest,
  ) {
    return this.auth.confirmPhone(req.platformAdmin!.id, body.code, requestMeta(req));
  }

  @Post('auth/2fa/verify')
  @HttpCode(200)
  async verifyTwoFactor(
    @Body(new ZodPipe(challengeSchema)) body: z.infer<typeof challengeSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, admin } = await this.auth.completeTwoFactor(
      body.challengeToken,
      body.code,
      requestMeta(req),
    );
    res.cookie(PLATFORM_COOKIE, token, this.auth.cookieOptions());
    return { status: 'OK' as const, admin };
  }

  @UseGuards(PlatformGuard)
  @AllowBeforeTwoFactor()
  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: PlatformRequest, @Res({ passthrough: true }) res: Response) {
    const admin = req.platformAdmin!;
    await this.auth.logout(admin.sessionId, admin.id, requestMeta(req));
    res.clearCookie(PLATFORM_COOKIE, { ...this.auth.cookieOptions(), maxAge: undefined });
  }

  @UseGuards(PlatformGuard)
  @AllowBeforeTwoFactor()
  @Get('auth/me')
  me(@Req() req: PlatformRequest) {
    const { sessionId: _session, ...admin } = req.platformAdmin!;
    return { admin };
  }

  @UseGuards(PlatformGuard)
  @AllowBeforeTwoFactor()
  @Post('auth/2fa/setup')
  @HttpCode(200)
  setupTwoFactor(@Req() req: PlatformRequest) {
    return this.auth.beginTwoFactorSetup(req.platformAdmin!.id);
  }

  @UseGuards(PlatformGuard)
  @AllowBeforeTwoFactor()
  @Post('auth/2fa/enable')
  @HttpCode(204)
  async enableTwoFactor(
    @Body(new ZodPipe(codeSchema)) body: z.infer<typeof codeSchema>,
    @Req() req: PlatformRequest,
  ) {
    await this.auth.enableTwoFactor(req.platformAdmin!.id, body.code, requestMeta(req));
  }

  @UseGuards(PlatformGuard)
  @Get('companies')
  list() {
    return this.platform.list();
  }

  @UseGuards(PlatformGuard)
  @Post('companies')
  create(
    @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>,
    @Req() req: PlatformRequest,
  ) {
    return this.platform.create(body, req.platformAdmin!.id, requestMeta(req));
  }

  @UseGuards(PlatformGuard)
  @Get('companies/:id')
  detail(@Param('id', companyId) id: string) {
    return this.platform.detail(id);
  }

  @UseGuards(PlatformGuard)
  @Patch('companies/:id')
  update(
    @Param('id', companyId) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
    @Req() req: PlatformRequest,
  ) {
    return this.platform.update(id, body, req.platformAdmin!.id, requestMeta(req));
  }

  @UseGuards(PlatformGuard)
  @Put('companies/:id/secrets')
  secrets(
    @Param('id', companyId) id: string,
    @Body(new ZodPipe(secretsSchema)) body: z.infer<typeof secretsSchema>,
    @Req() req: PlatformRequest,
  ) {
    return this.platform.setSecrets(id, body, req.platformAdmin!.id, requestMeta(req));
  }

  @UseGuards(PlatformGuard)
  @Post('companies/:id/webhook-token')
  @HttpCode(200)
  rotateWebhook(@Param('id', companyId) id: string, @Req() req: PlatformRequest) {
    return this.platform.rotateWebhookToken(id, req.platformAdmin!.id, requestMeta(req));
  }

  @UseGuards(PlatformGuard)
  @Get('companies/:id/usage')
  usage(@Param('id', companyId) id: string) {
    return this.platform.usage(id);
  }
}
