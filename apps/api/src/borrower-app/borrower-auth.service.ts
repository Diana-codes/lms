import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  BUSINESS_SECTORS,
  REGISTRATION_CONSENT_VERSION,
  REGISTRATION_PRIVACY_POINTS,
  certainlyUnderAge,
  maskPhone,
  nationalIdBirthYear,
  normaliseRwPhone,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import { nextBorrowerCode } from '../common/codes';
import { PiiCrypto } from '../common/pii-crypto';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { SmsService } from '../sms/sms.service';
import { companyFeatures, requireCompanyId } from '../tenancy/company-context';

export interface BorrowerClaims {
  sub: string;
  sid: string;
  /** The lender the borrower signed in with. */
  cid: string;
  typ: 'borrower';
}

export interface BorrowerTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** The phone is proven but has no account yet: finish signing up with this token. */
export interface RegistrationNeeded {
  registrationToken: string;
  phone: string;
}

interface RegistrationClaims {
  phone: string;
  typ: 'register';
}

export interface RegisterInput {
  registrationToken: string;
  fullName: string;
  nationalId: string;
  businessName?: string;
  businessSector?: string;
  branchCode: string;
  agreedTerms: boolean;
  agreedDataProcessing: boolean;
  marketingSms: boolean;
  consentVersion: string;
}

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
/** At most this many codes per phone per hour, to stop SMS being used to spam someone. */
const OTP_PER_HOUR = 5;
/** Time to fill in the sign-up form after the code is checked. */
const REGISTRATION_TTL_SECONDS = 30 * 60;
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
    private readonly providers: ProvidersService,
    private readonly audit: AuditService,
    private readonly crypto: PiiCrypto,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async requestCode(
    input: string,
    meta: RequestMeta,
  ): Promise<
    | { otpRequired: true; sent: true; phone: string }
    | ({ otpRequired: false; phone: string } & BorrowerTokens)
  > {
    const phone = normaliseRwPhone(input);
    if (!phone) throw new BadRequestException('Enter a Rwandan mobile number, e.g. 078 812 3412');

    const borrower = await this.prisma.borrower.findFirst({
      where: { phone },
      select: { id: true, code: true, preferredLanguage: true },
    });

    // Company has borrower OTP off: known phones sign in with the number alone.
    if (!companyFeatures().borrowerOtp) {
      if (!borrower) {
        throw new BadRequestException(
          'We do not have an account for that number. Ask your lender to register you first.',
        );
      }
      await this.audit.record({
        action: 'borrower.login',
        actorType: 'BORROWER',
        actorId: borrower.id,
        entityType: 'Borrower',
        entityId: borrower.code,
        metadata: { otp: false },
        ...meta,
      });
      return {
        otpRequired: false,
        phone: maskPhone(phone),
        ...(await this.startSession(borrower.id, meta)),
      };
    }

    const recent = await this.prisma.otpChallenge.count({
      where: { phone, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
    });
    if (recent >= OTP_PER_HOUR) {
      throw new HttpException(
        'Too many codes requested. Try again in an hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    // Known numbers get a sign-in code; new numbers a code to sign up with.
    // The answer is the same either way, so it never reveals who is a customer.
    if (!borrower && meta.ip) {
      // Each sign-up code is an SMS to a stranger: cap how many one IP can trigger.
      const fromIp = await this.prisma.otpChallenge.count({
        where: { ip: meta.ip, signup: true, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
      });
      if (fromIp >= this.env.SIGNUP_CODES_PER_IP_PER_HOUR) {
        throw new HttpException(
          'Too many codes requested. Try again in an hour.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpChallenge.create({
      data: {
        phone,
        codeHash: sha256(`${phone}:${code}`),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
        ip: meta.ip ?? null,
        signup: !borrower,
      },
    });
    const language = borrower?.preferredLanguage;
    await this.sms.send({
      toPhone: phone,
      borrowerId: borrower?.id,
      template: 'otp',
      language,
      body: this.sms.render('otp', { code }, language),
    });
    // Local development only: with the SMS simulator nothing is texted, so show the code
    // in the API log. Production never uses the simulator.
    if (this.env.NODE_ENV === 'development' && (await this.providers.sms()).name === 'simulator') {
      this.logger.warn(`Development sign-in code for ${maskPhone(phone)}: ${code}`);
    }
    await this.audit.record({
      action: 'borrower.otp.request',
      actorType: 'BORROWER',
      metadata: { phone: maskPhone(phone), known: !!borrower },
      ...meta,
    });
    return { otpRequired: true, sent: true, phone: maskPhone(phone) };
  }

  /**
   * Check the texted code. A customer gets a session; a new number gets a
   * short-lived token to finish signing up with (it proves they own the phone).
   */
  async verifyCode(
    input: string,
    code: string,
    meta: RequestMeta,
  ): Promise<BorrowerTokens | RegistrationNeeded> {
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
    await this.prisma.otpChallenge.update({
      where: { id: challenge!.id },
      data: { consumedAt: new Date() },
    });
    const borrower = await this.prisma.borrower.findFirst({ where: { phone } });
    if (!borrower) {
      await this.audit.record({
        action: 'borrower.register.phone_verified',
        actorType: 'BORROWER',
        metadata: { phone: maskPhone(phone) },
        ...meta,
      });
      const claims: RegistrationClaims = { phone, typ: 'register' };
      return {
        registrationToken: await this.jwt.signAsync(claims, {
          expiresIn: REGISTRATION_TTL_SECONDS,
        }),
        phone: maskPhone(phone),
      };
    }
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

  /** What the sign-up form needs: branches to choose from, sectors and the privacy notice. */
  async registrationOptions() {
    const branches = await this.prisma.branch.findMany({
      orderBy: { name: 'asc' },
      select: { code: true, name: true, district: true },
    });
    return {
      branches,
      sectors: BUSINESS_SECTORS,
      consentVersion: REGISTRATION_CONSENT_VERSION,
      privacy: REGISTRATION_PRIVACY_POINTS,
    };
  }

  /**
   * Open an account for someone who proved their phone number. They start
   * unverified with no officer: staff check their ID and take them on before
   * any loan is approved.
   */
  async register(input: RegisterInput, meta: RequestMeta): Promise<BorrowerTokens> {
    let phone: string;
    try {
      const claims = await this.jwt.verifyAsync<RegistrationClaims>(input.registrationToken);
      if (claims.typ !== 'register') throw new Error('wrong token');
      phone = claims.phone;
    } catch {
      throw new UnauthorizedException('Your sign-up has expired. Enter your number again.');
    }
    if (!input.agreedTerms || !input.agreedDataProcessing)
      throw new BadRequestException('Please agree to the terms and the privacy notice');
    if (input.consentVersion !== REGISTRATION_CONSENT_VERSION)
      throw new ConflictException('The sign-up terms have changed. Please read them again.');
    const year = new Date().getFullYear();
    const birthYear = nationalIdBirthYear(input.nationalId, year);
    if (birthYear == null) throw new BadRequestException('Check your national ID number');
    if (certainlyUnderAge(birthYear, year))
      throw new BadRequestException('You must be 18 or older to borrow from Kora Lend');
    const branch = await this.prisma.branch.findFirst({ where: { code: input.branchCode } });
    if (!branch) throw new BadRequestException('Choose a branch');

    const idHash = this.crypto.lookupHash(input.nationalId);
    const taken = await this.prisma.borrower.findFirst({
      where: { nationalIdHash: idHash },
      select: { id: true, code: true, branchId: true },
    });
    if (taken) {
      // Either a returning customer on a new number or someone using another's ID.
      // Tell staff either way; tell the person to visit a branch.
      await this.audit.record({
        action: 'borrower.register.duplicate_id',
        actorType: 'BORROWER',
        entityType: 'Borrower',
        entityId: taken.code,
        metadata: { phone: maskPhone(phone) },
        ...meta,
      });
      await this.notifyManagers(
        taken.branchId,
        `Someone tried to sign up in the app with the ID number of ${taken.code}, from ${maskPhone(phone)}`,
        `/borrowers/${taken.code}`,
      );
      throw new ConflictException(
        'That ID number is already registered. If it is yours, please visit a branch.',
      );
    }

    const borrower = await this.prisma.$transaction(async (tx) => {
      if (await tx.borrower.findFirst({ where: { phone }, select: { id: true } }))
        throw new ConflictException('This number already has an account. Sign in instead.');
      const created = await tx.borrower.create({
        data: {
          code: await nextBorrowerCode(tx),
          fullName: input.fullName,
          phone,
          nationalIdEnc: this.crypto.encrypt(input.nationalId),
          nationalIdHash: idHash,
          nationalIdLast3: input.nationalId.slice(-3),
          branchId: branch.id,
          source: 'APP',
          kycStatus: 'PENDING',
        },
      });
      if (input.businessName) {
        await tx.business.create({
          data: {
            borrowerId: created.id,
            name: input.businessName,
            sector: input.businessSector ?? null,
            borrowerRole: 'Owner',
          },
        });
      }
      const consent = {
        borrowerId: created.id,
        textVersion: input.consentVersion,
        channel: 'APP' as const,
        ip: meta.ip ?? null,
      };
      await tx.consent.createMany({
        data: [
          { ...consent, type: 'TERMS' },
          { ...consent, type: 'DATA_PROCESSING' },
          ...(input.marketingSms ? [{ ...consent, type: 'MARKETING_SMS' as const }] : []),
        ],
      });
      await this.audit.record(
        {
          action: 'borrower.register',
          actorType: 'BORROWER',
          actorId: created.id,
          entityType: 'Borrower',
          entityId: created.code,
          metadata: {
            phone: maskPhone(phone),
            branch: branch.code,
            marketingSms: input.marketingSms,
          },
          ...meta,
        },
        tx,
      );
      return created;
    });
    await this.notifyManagers(
      branch.id,
      `${borrower.fullName} signed up in the app and needs an officer`,
      `/borrowers/${borrower.code}`,
    );
    return this.startSession(borrower.id, meta);
  }

  /** Tell the branch's managers; if it has none, every console user sees it. */
  private async notifyManagers(branchId: string | null, title: string, href: string) {
    const managers = branchId
      ? await this.prisma.user.findMany({
          where: { branchId, role: 'MANAGER', isActive: true },
          select: { id: true },
        })
      : [];
    await this.prisma.notification.createMany({
      data: managers.length
        ? managers.map((m) => ({ userId: m.id, kind: 'SYSTEM' as const, title, href }))
        : [{ kind: 'SYSTEM' as const, title, href }],
    });
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

  /** Check the token's signature and type. The guard then confirms its company and session. */
  async verifyToken(token: string): Promise<BorrowerClaims> {
    const claims = await this.jwt.verifyAsync<BorrowerClaims>(token);
    if (claims.typ !== 'borrower') throw new UnauthorizedException();
    return claims;
  }

  /** The session must still be open. Runs once the request's company is settled. */
  async checkSession(claims: BorrowerClaims): Promise<BorrowerClaims> {
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
    const claims: BorrowerClaims = {
      sub: borrowerId,
      sid: sessionId,
      cid: requireCompanyId(),
      typ: 'borrower',
    };
    return this.jwt.signAsync(claims, { expiresIn: this.env.BORROWER_ACCESS_TTL_SECONDS });
  }

  private expiry(): Date {
    return new Date(Date.now() + this.env.BORROWER_REFRESH_TTL_DAYS * 86_400_000);
  }
}
