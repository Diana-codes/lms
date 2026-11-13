import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { maskPhone, normaliseRwPhone } from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';

export interface BorrowerClaims {
  sub: string;
  sid: string;
  typ: 'borrower';
}

export interface BorrowerTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
/** At most this many codes per phone per hour, to stop SMS being used to spam someone. */
const OTP_PER_HOUR = 5;
const sha256 = (v: string) => createHash('sha256').update(v).digest('base64url');

/**
 * Phone + one-time code sign-in for the borrower app. Only a hash of each
 * code is stored, codes expire after five minutes, five wrong tries burn
 * the code, and the response never reveals whether a number is known.
 */
@Injectable()
export class BorrowerAuthService {
  private readonly logger = new Logger(BorrowerAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly sms: SmsService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async requestCode(input: string, meta: RequestMeta): Promise<{ sent: true; phone: string }> {
    const phone = normaliseRwPhone(input);
    if (!phone) throw new BadRequestException('Enter a Rwandan mobile number, e.g. 078 812 3412');
    const recent = await this.prisma.otpChallenge.count({
      where: { phone, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
    });
    if (recent >= OTP_PER_HOUR) {
      throw new HttpException(
        'Too many codes requested. Try again in an hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // A code is only sent to numbers we know, but the answer is the same either way.
    const borrower = await this.prisma.borrower.findUnique({
      where: { phone },
      select: { id: true },
    });
    if (borrower) {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await this.prisma.otpChallenge.create({
        data: {
          phone,
          codeHash: sha256(`${phone}:${code}`),
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
        },
      });
      await this.sms.send({
        toPhone: phone,
        borrowerId: borrower.id,
        template: 'otp',
        body: this.sms.render('otp', { code }),
      });
      // Local development only: with the SMS simulator nothing is texted, so show the code
      // in the API log. Production refuses to start without a real SMS provider.
      if (this.env.NODE_ENV === 'development' && !this.env.AFRICASTALKING_API_KEY) {
        this.logger.warn(`Development sign-in code for ${maskPhone(phone)}: ${code}`);
      }
    }
    await this.audit.record({
      action: 'borrower.otp.request',
      actorType: 'BORROWER',
      metadata: { phone: maskPhone(phone), known: !!borrower },
      ...meta,
    });
    return { sent: true, phone: maskPhone(phone) };
  }

  async verifyCode(input: string, code: string, meta: RequestMeta): Promise<BorrowerTokens> {
    const phone = normaliseRwPhone(input);
    if (!phone || !/^\d{6}$/.test(code)) throw new UnauthorizedException('That code is not valid');
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    const matches =
      challenge != null &&
      challenge.attempts < OTP_MAX_ATTEMPTS &&
      timingSafeEqual(Buffer.from(challenge.codeHash), Buffer.from(sha256(`${phone}:${code}`)));
    if (!matches) {
      if (challenge)
        await this.prisma.otpChallenge.update({
          where: { id: challenge.id },
          data: { attempts: { increment: 1 } },
        });
      await this.audit.record({
        action: 'borrower.otp.failed',
        actorType: 'BORROWER',
        metadata: { phone: maskPhone(phone) },
        ...meta,
      });
      throw new UnauthorizedException('That code is not valid');
    }
    const borrower = await this.prisma.borrower.findUniqueOrThrow({ where: { phone } });
    await this.prisma.otpChallenge.update({
      where: { id: challenge!.id },
      data: { consumedAt: new Date() },
    });
    await this.audit.record({
      action: 'borrower.login',
      actorType: 'BORROWER',
      actorId: borrower.id,
      entityType: 'Borrower',
      entityId: borrower.code,
      ...meta,
    });
    return this.startSession(borrower.id, meta);
  }

  async refresh(refreshToken: string): Promise<BorrowerTokens> {
    const session = await this.prisma.borrowerSession.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date())
      throw new UnauthorizedException('Session expired. Sign in again.');
    const next = randomBytes(32).toString('base64url');
    const rotated = await this.prisma.borrowerSession.updateMany({
      where: { id: session.id, refreshTokenHash: session.refreshTokenHash },
      data: { refreshTokenHash: sha256(next), lastUsedAt: new Date(), expiresAt: this.expiry() },
    });
    if (rotated.count !== 1) throw new UnauthorizedException('Session expired. Sign in again.');
    return {
      accessToken: await this.sign(session.borrowerId, session.id),
      refreshToken: next,
      expiresIn: this.env.BORROWER_ACCESS_TTL_SECONDS,
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.prisma.borrowerSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyAccess(token: string): Promise<BorrowerClaims> {
    const claims = await this.jwt.verifyAsync<BorrowerClaims>(token);
    if (claims.typ !== 'borrower') throw new UnauthorizedException();
    const session = await this.prisma.borrowerSession.findUnique({ where: { id: claims.sid } });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.borrowerId !== claims.sub
    )
      throw new UnauthorizedException('Session expired');
    return claims;
  }

  private async startSession(borrowerId: string, meta: RequestMeta): Promise<BorrowerTokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    const session = await this.prisma.borrowerSession.create({
      data: {
        borrowerId,
        refreshTokenHash: sha256(refreshToken),
        deviceName: meta.userAgent?.slice(0, 120) ?? null,
        expiresAt: this.expiry(),
      },
    });
    return {
      accessToken: await this.sign(borrowerId, session.id),
      refreshToken,
      expiresIn: this.env.BORROWER_ACCESS_TTL_SECONDS,
    };
  }

  private sign(borrowerId: string, sessionId: string): Promise<string> {
    const claims: BorrowerClaims = { sub: borrowerId, sid: sessionId, typ: 'borrower' };
    return this.jwt.signAsync(claims, { expiresIn: this.env.BORROWER_ACCESS_TTL_SECONDS });
  }

  private expiry(): Date {
    return new Date(Date.now() + this.env.BORROWER_REFRESH_TTL_DAYS * 86_400_000);
  }
}
