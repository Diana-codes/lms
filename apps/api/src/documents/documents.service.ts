import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DOCUMENT_INFO,
  documentChecklist,
  formatDate,
  kigaliDate,
  utcDateToIso,
  type Checklist,
  type DocumentType,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { UploadsService, type UploadedFileLike } from '../borrower-app/uploads.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';

const OPEN_STAGES = ['NEW', 'UNDER_REVIEW', 'CREDIT_CHECK', 'APPROVED'] as const;
/** Without an open application, every borrower is asked for at least these. */
const BASELINE: DocumentType[] = ['NATIONAL_ID', 'SELFIE'];

type Db = Prisma.TransactionClient | PrismaService;

export type BorrowerChecklist = Checklist & {
  applicationCode: string | null;
  productName: string | null;
};

/**
 * KYC documents end to end: what a borrower still has to send, their uploads,
 * and an officer viewing, verifying or rejecting them. Every view and decision
 * is written to the audit log; a rejection tells the borrower why, in the app
 * and by SMS, so they can fix it.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
    private readonly sms: SmsService,
  ) {}

  /** The borrower's documents against what their open application (or the baseline) needs. */
  async checklist(borrowerId: string, db: Db = this.prisma): Promise<BorrowerChecklist> {
    const b = await db.borrower.findUniqueOrThrow({
      where: { id: borrowerId },
      select: {
        kycStatus: true,
        kycDocuments: { where: { supersededAt: null }, orderBy: { uploadedAt: 'asc' } },
        consents: { where: { type: 'MOMO_HISTORY', revokedAt: null }, select: { id: true } },
        applications: {
          where: { stage: { in: [...OPEN_STAGES] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { code: true, product: { select: { name: true, requiredDocuments: true } } },
        },
      },
    });
    const app = b.applications[0];
    const checklist = documentChecklist({
      required: app?.product.requiredDocuments ?? BASELINE,
      docs: b.kycDocuments.map((d) => ({
        type: d.type,
        status: d.status,
        expiresOn: d.expiresOn ? utcDateToIso(d.expiresOn) : null,
        rejectionReason: d.rejectionReason,
      })),
      today: kigaliDate(),
      momoHistoryShared: b.consents.length > 0,
      identityVerified: b.kycStatus === 'VERIFIED',
    });
    return {
      ...checklist,
      applicationCode: app?.code ?? null,
      productName: app?.product.name ?? null,
    };
  }

  /** Keep an application's "documents 3/4" in step with what the borrower has actually sent. */
  async syncApplication(borrowerId: string, db: Db): Promise<void> {
    const app = await db.application.findFirst({
      where: { borrowerId, stage: { in: [...OPEN_STAGES] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!app) return;
    const c = await this.checklist(borrowerId, db);
    await db.application.update({
      where: { id: app.id },
      data: { docsReceived: c.received, docsRequired: c.required },
    });
  }

  // ── borrower side ──────────────────────────────────────────────────────

  async upload(
    borrowerId: string,
    type: DocumentType,
    file: UploadedFileLike | undefined,
    meta: RequestMeta,
  ): Promise<BorrowerChecklist> {
    if (!file) throw new BadRequestException('Attach a photo or a PDF');
    const current = await this.prisma.kycDocument.findFirst({
      where: { borrowerId, type, supersededAt: null },
      orderBy: { uploadedAt: 'desc' },
    });
    const stillValid =
      current?.status === 'VERIFIED' &&
      (!current.expiresOn || utcDateToIso(current.expiresOn) >= kigaliDate());
    if (type !== 'OTHER' && stillValid) {
      throw new ConflictException(`Your ${DOCUMENT_INFO[type].name} is already verified`);
    }
    const stored = await this.uploads.store(borrowerId, type, file);

    const doc = await this.prisma.$transaction(async (tx) => {
      // A new file replaces the old one of the same type; the old row stays for the record.
      if (type !== 'OTHER') {
        await tx.kycDocument.updateMany({
          where: { borrowerId, type, supersededAt: null },
          data: { supersededAt: new Date() },
        });
      }
      const app = await tx.application.findFirst({
        where: { borrowerId, stage: { in: [...OPEN_STAGES] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, code: true, officerId: true },
      });
      const created = await tx.kycDocument.create({
        data: {
          borrowerId,
          type,
          status: 'PENDING',
          storageKey: stored.key,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          applicationId: app?.id ?? null,
        },
        include: { borrower: { select: { code: true, fullName: true, officerId: true } } },
      });
      await this.syncApplication(borrowerId, tx);
      // Let the officer know there is something to check.
      const officerId = app?.officerId ?? created.borrower.officerId;
      await tx.notification.create({
        data: {
          userId: officerId,
          kind: 'DOCUMENT',
          title: `${created.borrower.fullName} uploaded ${DOCUMENT_INFO[type].name}${app ? ` for ${app.code}` : ''}`,
          href: `/borrowers/${created.borrower.code}`,
        },
      });
      await this.audit.record(
        {
          action: 'borrower.document.upload',
          actorType: 'BORROWER',
          actorId: borrowerId,
          entityType: 'KycDocument',
          entityId: created.id,
          metadata: { type, mimeType: stored.mimeType, sizeBytes: stored.sizeBytes },
          ...meta,
        },
        tx,
      );
      return created;
    });
    this.logger.log(`Document ${doc.id} (${type}) uploaded`);
    return this.checklist(borrowerId);
  }

  /** Files from the apply flow: only keys this borrower's own uploads produced are accepted. */
  ownsKey(borrowerId: string, key: string): boolean {
    return key.startsWith(UploadsService.prefix(borrowerId)) && !key.includes('..');
  }

  // ── console side ───────────────────────────────────────────────────────

  private async findDoc(borrowerCode: string, id: string) {
    const doc = await this.prisma.kycDocument.findFirst({
      where: { id, borrower: { code: borrowerCode } },
      include: { borrower: true },
    });
    if (!doc) throw new NotFoundException('No such document');
    return doc;
  }

  /** The file behind a document, for an officer to look at. Every view is audited. */
  async file(borrowerCode: string, id: string, user: AuthUser, meta: RequestMeta) {
    const doc = await this.findDoc(borrowerCode, id);
    const path = await this.uploads.locate(doc.storageKey);
    if (!path) throw new NotFoundException('This file is not available');
    await this.audit.record({
      action: 'document.view',
      actorId: user.id,
      entityType: 'KycDocument',
      entityId: doc.id,
      metadata: { borrower: borrowerCode, type: doc.type },
      ...meta,
    });
    const ext = doc.mimeType === 'application/pdf' ? 'pdf' : (doc.mimeType?.split('/')[1] ?? 'bin');
    return {
      path,
      mimeType: doc.mimeType ?? 'application/octet-stream',
      fileName: `${borrowerCode}-${doc.type.toLowerCase()}.${ext}`,
    };
  }

  async review(
    borrowerCode: string,
    id: string,
    decision: { verify: true } | { verify: false; reason: string },
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const doc = await this.findDoc(borrowerCode, id);
    if (doc.supersededAt) throw new ConflictException('A newer file has replaced this one');
    if (doc.status !== 'PENDING') {
      throw new ConflictException(
        `This document is already ${doc.status === 'VERIFIED' ? 'verified' : 'rejected'}`,
      );
    }
    if (decision.verify && !(await this.uploads.locate(doc.storageKey))) {
      throw new ConflictException('There is no file to check. Ask the borrower to upload it.');
    }
    const name = DOCUMENT_INFO[doc.type].name;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.kycDocument.update({
        where: { id: doc.id },
        data: decision.verify
          ? {
              status: 'VERIFIED',
              verifiedAt: now,
              verifiedById: user.id,
              verifiedVia: 'Officer review',
            }
          : { status: 'REJECTED', rejectionReason: decision.reason, rejectedAt: now },
      });
      // ID and selfie both checked by a person means the customer's identity is verified.
      if (decision.verify && (doc.type === 'NATIONAL_ID' || doc.type === 'SELFIE')) {
        const verified = await tx.kycDocument.findMany({
          where: {
            borrowerId: doc.borrowerId,
            type: { in: ['NATIONAL_ID', 'SELFIE'] },
            status: 'VERIFIED',
            supersededAt: null,
          },
          select: { type: true },
        });
        if (new Set(verified.map((v) => v.type)).size === 2) {
          await tx.borrower.update({
            where: { id: doc.borrowerId },
            data: { kycStatus: 'VERIFIED' },
          });
        }
      }
      await this.syncApplication(doc.borrowerId, tx);
      await tx.notification.create({
        data: {
          borrowerId: doc.borrowerId,
          kind: 'DOCUMENT',
          title: decision.verify
            ? `Your ${name} has been verified`
            : `Please upload your ${name} again: ${decision.reason}`,
          href: 'documents',
        },
      });
      await this.audit.record(
        {
          action: decision.verify ? 'document.verify' : 'document.reject',
          actorId: user.id,
          entityType: 'KycDocument',
          entityId: doc.id,
          metadata: {
            borrower: borrowerCode,
            type: doc.type,
            ...(decision.verify ? {} : { reason: decision.reason }),
          },
          ...meta,
        },
        tx,
      );
    });

    if (!decision.verify) {
      // The SMS is a courtesy; the in-app notice is already saved if it fails.
      try {
        await this.sms.send({
          toPhone: doc.borrower.phone,
          borrowerId: doc.borrowerId,
          sentById: user.id,
          body: `Kora Lend: we could not accept your ${name}. ${decision.reason} Please upload it again in the Kora Lend app.`,
        });
      } catch (err) {
        this.logger.warn(`Rejection SMS for document ${doc.id} failed: ${(err as Error).message}`);
      }
    }
    return {
      status: decision.verify ? 'VERIFIED' : 'REJECTED',
      reviewedOn: formatDate(kigaliDate(now)),
    };
  }
}
