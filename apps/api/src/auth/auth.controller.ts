import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { ENV, type Env } from '../config/env';
import { AuthService, type PublicUser, type RequestMeta, type SessionTokens } from './auth.service';
import { ACCESS_COOKIE, type AuthUser, REFRESH_COOKIE } from './auth.types';
import { CurrentUser, Public } from './decorators';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254)),
  password: z.string().min(1).max(200),
});
const codeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
const twoFactorSchema = z.object({ challengeToken: z.string().min(1), code: codeSchema });
const enableSchema = z.object({ code: codeSchema });
const disableSchema = z.object({ password: z.string().min(1).max(200), code: codeSchema });
const refreshSchema = z.object({ refreshToken: z.string().min(1).optional() }).optional();

const meta = (req: Request): RequestMeta => ({ ip: req.ip, userAgent: req.get('user-agent') });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body.email, body.password, meta(req));
    if (result.status === 'TOTP_REQUIRED') return result;
    return this.respondWithSession(res, result.tokens, result.user);
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(200)
  async verifyTwoFactor(
    @Body(new ZodPipe(twoFactorSchema)) body: z.infer<typeof twoFactorSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { tokens, user } = await this.auth.completeTwoFactor(
      body.challengeToken,
      body.code,
      meta(req),
    );
    return this.respondWithSession(res, tokens, user);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body(new ZodPipe(refreshSchema)) body: z.infer<typeof refreshSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const token = body?.refreshToken ?? cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('Session expired. Sign in again.');
    try {
      const { tokens, user } = await this.auth.refresh(token, meta(req));
      return this.respondWithSession(res, tokens, user, body?.refreshToken != null);
    } catch (err) {
      this.clearCookies(res);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user.sessionId, user.id, meta(req));
    this.clearCookies(res);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Omit<AuthUser, 'sessionId'> {
    const { sessionId: _sessionId, ...rest } = user;
    return rest;
  }

  @Post('2fa/setup')
  @HttpCode(200)
  setupTwoFactor(@CurrentUser() user: AuthUser) {
    return this.auth.beginTwoFactorSetup(user.id);
  }

  @Post('2fa/enable')
  @HttpCode(204)
  async enableTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(enableSchema)) body: z.infer<typeof enableSchema>,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.enableTwoFactor(user.id, body.code, meta(req));
  }

  @Post('2fa/disable')
  @HttpCode(204)
  async disableTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(disableSchema)) body: z.infer<typeof disableSchema>,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.disableTwoFactor(user.id, body.password, body.code, meta(req));
  }

  // ── cookies ────────────────────────────────────────────────────────────

  /**
   * The console gets its tokens as httpOnly cookies, which page scripts
   * cannot read. Clients that sent a refresh token in the body (the mobile
   * app) get the new one back in the body instead.
   */
  private respondWithSession(
    res: Response,
    tokens: SessionTokens,
    user: PublicUser,
    tokenInBody = false,
  ) {
    const base = {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax' as const,
      path: '/',
    };
    res.cookie(ACCESS_COOKIE, tokens.accessToken, {
      ...base,
      maxAge: tokens.accessTtlSeconds * 1000,
    });
    if (tokens.refreshToken) {
      res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
        ...base,
        expires: tokens.refreshExpiresAt,
      });
    }
    return {
      status: 'OK' as const,
      user,
      accessToken: tokens.accessToken,
      expiresIn: tokens.accessTtlSeconds,
      ...(tokenInBody && tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
    };
  }

  private clearCookies(res: Response): void {
    const base = {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax' as const,
      path: '/',
    };
    res.clearCookie(ACCESS_COOKIE, base);
    res.clearCookie(REFRESH_COOKIE, base);
  }
}
