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
import { PLATFORM_COOKIE, PlatformAuthService } from './platform-auth.service';
import { PlatformGuard, type PlatformRequest } from './platform.guard';
import { PlatformService, SETTABLE_SECRETS } from './platform.service';

const companyId = new ZodPipe(z.uuid());
const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #0E3B2E');
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Not a known time zone');

const loginSchema = z.object({ email: z.string().trim().min(3), password: z.string().min(1) });

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
    logoUrl: z.url().max(500).nullable().optional(),
    timezone: timezone.optional(),
    defaultLanguage: z.enum(['EN', 'RW', 'FR']).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    aiFeatures: z.boolean().optional(),
    autoApprove: z.boolean().optional(),
  })
  .strict();

const secretsSchema = z
  .object(
    Object.fromEntries(
      Object.keys(SETTABLE_SECRETS).map((k) => [
        k,
        z.string().trim().max(200).nullable().optional(),
      ]),
    ) as Record<keyof typeof SETTABLE_SECRETS, z.ZodOptional<z.ZodNullable<z.ZodString>>>,
  )
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
    const { token, admin } = await this.auth.login(body.email, body.password, requestMeta(req));
    res.cookie(PLATFORM_COOKIE, token, this.auth.cookieOptions());
    return { admin };
  }

  @UseGuards(PlatformGuard)
  @Post('auth/logout')
  @HttpCode(204)
  async logout(@Req() req: PlatformRequest, @Res({ passthrough: true }) res: Response) {
    const admin = req.platformAdmin!;
    await this.auth.logout(admin.sessionId, admin.id, requestMeta(req));
    res.clearCookie(PLATFORM_COOKIE, { ...this.auth.cookieOptions(), maxAge: undefined });
  }

  @UseGuards(PlatformGuard)
  @Get('auth/me')
  me(@Req() req: PlatformRequest) {
    const { sessionId: _session, ...admin } = req.platformAdmin!;
    return { admin };
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
