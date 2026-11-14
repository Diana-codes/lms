import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { HttpException, HttpStatus, Logger, ServiceUnavailableException } from '@nestjs/common';
import { maskPhone } from '@kora/core';
import type { PiiCrypto } from '../common/pii-crypto';
import type { CodePurpose } from '../generated/prisma/client';
import type { SmsGateway } from '../providers/sms.gateway';

export const CODE_TTL_MINUTES = 5;
const MAX_ATTEMPTS = 5;
/** At most this many codes per person per hour, so texts cannot be used to pester someone. */
const PER_HOUR = 10;
const RESEND_AFTER_SECONDS = 30;

export interface CodeRow {
  id: string;
  subjectId: string;
  purpose: CodePurpose;
  phone: string;
  codeHash: string;
  attempts: number;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

/** What a code book needs from its table. StaffCode and PlatformCode both fit. */
export interface CodeTable {
  count(args: { where: { subjectId: string; createdAt: { gte: Date } } }): PromiseLike<number>;
  findFirst(args: {
    where: { subjectId: string; purpose: CodePurpose; consumedAt: null };
    orderBy: { createdAt: 'desc' };
  }): PromiseLike<CodeRow | null>;
  create(args: {
    data: {
      id: string;
      subjectId: string;
      purpose: CodePurpose;
      phone: string;
      codeHash: string;
      expiresAt: Date;
    };
  }): PromiseLike<CodeRow>;
  update(args: {
    where: { id: string };
    data: { attempts: { increment: number } };
  }): PromiseLike<unknown>;
  updateMany(args: {
    where: { id: string; consumedAt: null };
    data: { consumedAt: Date };
  }): PromiseLike<{ count: number }>;
}

const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Six-digit codes sent by text: the second step of sign-in, or proof that a
 * phone number is yours. Only an HMAC of each code is stored (keyed with the
 * server's secret, so a copy of the database alone does not reveal codes).
 * Codes last five minutes, only the newest one counts, and five wrong tries
 * burn it.
 */
export class TextCodes {
  private readonly logger = new Logger('TextCodes');

  constructor(
    private readonly table: () => CodeTable,
    private readonly crypto: PiiCrypto,
    private readonly sms: () => SmsGateway,
    /** Development only: log codes when the simulator is in use, since nothing is texted. */
    private readonly logSimulated: boolean,
  ) {}

  /**
   * Text a new code. `resend` marks a "send another" request, which must wait
   * a little after the previous code; every send counts towards the hourly cap.
   */
  async send(
    subjectId: string,
    purpose: CodePurpose,
    phone: string,
    message: (code: string) => string,
    opts: { resend?: boolean } = {},
  ): Promise<{ sentTo: string }> {
    const table = this.table();
    const recent = await table.count({
      where: { subjectId, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
    });
    if (recent >= PER_HOUR) {
      throw new HttpException(
        'Too many codes requested. Try again in an hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (opts.resend) {
      const latest = await table.findFirst({
        where: { subjectId, purpose, consumedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      const wait = latest
        ? RESEND_AFTER_SECONDS - Math.floor((Date.now() - latest.createdAt.getTime()) / 1000)
        : 0;
      if (wait > 0) {
        throw new HttpException(
          `Wait ${wait} seconds before asking for another code.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await table.create({
      data: {
        id,
        subjectId,
        purpose,
        phone,
        codeHash: this.hash(id, code),
        expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
      },
    });
    const gateway = this.sms();
    const result = await gateway.send(phone, message(code));
    if (!result.accepted) {
      this.logger.warn(`Code to ${maskPhone(phone)} not sent: ${result.reason ?? 'refused'}`);
      throw new ServiceUnavailableException(
        'We could not send the text message. Try again in a minute.',
      );
    }
    if (this.logSimulated && gateway.name === 'simulator') {
      this.logger.warn(`Development code for ${maskPhone(phone)}: ${code}`);
    }
    return { sentTo: maskPhone(phone) };
  }

  /** The newest live code if `code` matches it (and it is now used up); otherwise null. */
  async verify(subjectId: string, purpose: CodePurpose, code: string): Promise<CodeRow | null> {
    const table = this.table();
    const row = await table.findFirst({
      where: { subjectId, purpose, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!row || row.expiresAt <= new Date() || row.attempts >= MAX_ATTEMPTS) return null;
    if (!/^\d{6}$/.test(code) || !safeEqual(row.codeHash, this.hash(row.id, code))) {
      await table.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      return null;
    }
    const used = await table.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return used.count === 1 ? row : null;
  }

  private hash(id: string, code: string): string {
    return this.crypto.lookupHash(`${id}:${code}`);
  }
}
