import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { identityFindings } from '@kora/core';
import { z } from 'zod';
import { AiClient, AiUnavailableError } from '../ai/ai.client';
import { AuditService } from '../audit/audit.service';
import { PiiCrypto } from '../common/pii-crypto';
import { ENV, type Env } from '../config/env';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** What Claude returns when reading the photo of a national ID. */
const idCardSchema = z.object({
  isRwandanNationalId: z
    .boolean()
    .describe('true only for the front of a Rwandan national identity card (Indangamuntu)'),
  fullName: z.string().nullable().describe('the name exactly as printed'),
  idNumber: z.string().nullable().describe('the 16-digit national ID number, digits only'),
  dateOfBirth: z.string().nullable().describe('YYYY-MM-DD, as printed'),
});

const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Reads a borrower's national ID photo and compares it with what they told
 * us: name, ID number (by hash, never stored in full) and age, and with the
 * names on their statements. Advisory only: staff see the findings and decide.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClient,
    private readonly audit: AuditService,
    private readonly crypto: PiiCrypto,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Check the borrower's current national ID photo. Re-run when the photo
   * changes or a statement arrives (its holder name is compared too).
   */
  async check(borrowerId: string): Promise<void> {
    const doc = await this.prisma.kycDocument.findFirst({
      where: {
        borrowerId,
        type: 'NATIONAL_ID',
        supersededAt: null,
        storageKey: { not: null },
        status: { not: 'REJECTED' },
      },
      orderBy: { uploadedAt: 'desc' },
    });
    if (!doc?.storageKey) return;
    const borrower = await this.prisma.borrower.findUniqueOrThrow({
      where: { id: borrowerId },
      select: { fullName: true, nationalIdHash: true },
    });
    const holders = (
      await this.prisma.cashflowDocument.findMany({
        where: { borrowerId, holderName: { not: null } },
        select: { holderName: true },
      })
    ).map((d) => d.holderName!);

    const save = async (data: Omit<Prisma.IdentityCheckUncheckedCreateInput, 'borrowerId' | 'kycDocumentId'>) => {
      const row = await this.prisma.identityCheck.create({
        data: { borrowerId, kycDocumentId: doc.id, ...data },
      });
      await this.audit.record({
        action: 'identity.check',
        actorType: 'SYSTEM',
        entityType: 'Borrower',
        entityId: borrowerId,
        metadata: {
          checkId: row.id,
          status: row.status,
          nameMatch: row.nameMatch,
          flags: (data.flags as Array<{ code: string }> | undefined)?.map((f) => f.code) ?? [],
        },
      });
    };

    if (!this.ai.configured) {
      // Record it once per photo, so staff can see why there is no check.
      const already = await this.prisma.identityCheck.findFirst({
        where: { kycDocumentId: doc.id, status: 'SKIPPED' },
      });
      if (!already)
        await save({
          status: 'SKIPPED',
          error: 'Reading ID photos needs AI assistance, which is not set up. Check the ID by eye.',
        });
      return;
    }
    if (!doc.mimeType || !PHOTO_TYPES.has(doc.mimeType)) {
      await save({ status: 'UNREADABLE', error: 'The ID was not sent as a photo' });
      return;
    }

    let card: z.infer<typeof idCardSchema>;
    try {
      const buffer = await readFile(path.join(this.env.UPLOAD_DIR, doc.storageKey));
      card = await this.ai.structured({
        schema: idCardSchema,
        file: {
          mediaType: doc.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
          base64: buffer.toString('base64'),
        },
        system:
          'You read Rwandan national identity cards for a lender checking a loan application. Copy what is printed exactly. Never guess: use null for anything you cannot read clearly.',
        user: 'Read this identity card.',
        effort: 'low',
        maxTokens: 800,
      });
    } catch (err) {
      const message =
        err instanceof AiUnavailableError ? err.message : 'The ID photo could not be read';
      this.logger.warn(`Identity check failed for borrower ${borrowerId}: ${message}`);
      await save({ status: 'UNREADABLE', error: `${message}. Check the ID by eye.` });
      return;
    }
    if (!card.isRwandanNationalId) {
      await save({
        status: 'UNREADABLE',
        modelVersion: this.ai.model,
        flags: [],
        error: 'The photo does not look like the front of a Rwandan national ID.',
      });
      return;
    }

    const digits = (card.idNumber ?? '').replace(/\D/g, '');
    const idNumberMatches =
      digits.length === 16 && borrower.nationalIdHash
        ? this.crypto.lookupHash(digits) === borrower.nationalIdHash
        : null;
    const { nameMatch, flags } = identityFindings({
      nameOnId: card.fullName,
      idNumberOnId: digits || null,
      dateOfBirth: card.dateOfBirth,
      givenName: borrower.fullName,
      idNumberMatches,
      statementHolders: holders,
      currentYear: new Date().getFullYear(),
    });
    await save({
      status: 'CHECKED',
      nameOnId: card.fullName?.slice(0, 120) ?? null,
      idLast3: digits.length >= 3 ? digits.slice(-3) : null,
      dateOfBirth: card.dateOfBirth,
      nameMatch,
      idNumberMatch: idNumberMatches,
      flags: flags as unknown as Prisma.InputJsonValue,
      modelVersion: this.ai.model,
    });
  }

  /** The newest check for a borrower, as shown to staff. */
  async latest(borrowerId: string) {
    const c = await this.prisma.identityCheck.findFirst({
      where: { borrowerId },
      orderBy: { createdAt: 'desc' },
    });
    if (!c) return null;
    return {
      status: c.status,
      nameOnId: c.nameOnId,
      idLast3: c.idLast3,
      dateOfBirth: c.dateOfBirth,
      nameMatch: c.nameMatch,
      idNumberMatch: c.idNumberMatch,
      flags: c.flags as Array<{ code: string; severity: 'HIGH' | 'MEDIUM'; message: string }>,
      modelVersion: c.modelVersion,
      error: c.error,
      checkedAt: c.createdAt.toISOString(),
    };
  }
}
