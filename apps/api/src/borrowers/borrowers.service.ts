import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  formatDate,
  formatMonthYear,
  initials,
  kigaliDate,
  maskNationalId,
  maskPhone,
  paymentTiming,
  ratioBps,
  scoreLabel,
  scorePercent,
  shortStaffName,
  utcDateToIso,
  type PaymentTiming,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { UploadsService } from '../borrower-app/uploads.service';
import { escapeLike } from '../common/http';
import type { KycDocumentType, Prisma } from '../generated/prisma/client';
import { ACCOUNTS } from '../ledger/accounts';
import { PrismaService } from '../prisma/prisma.service';

export const BORROWERS_PAGE_SIZE = 25;
/** How many upcoming instalments the payment-history strip shows. */
const UPCOMING_CELLS = 6;

const DOC_NAMES: Record<KycDocumentType, string> = {
  NATIONAL_ID: 'National ID',
  BUSINESS_REGISTRATION: 'Business registration (RDB)',
  FINANCIAL_STATEMENTS: 'Bank & MoMo statements',
  PROOF_OF_ADDRESS: 'Proof of address',
  SELFIE: 'Selfie',
  OTHER: 'Other document',
};

export type HistoryCell = PaymentTiming | 'MISSED' | 'UPCOMING';

const short = (u: { firstName: string; lastName: string } | null | undefined) =>
  u ? shortStaffName(u.firstName, u.lastName) : null;

@Injectable()
export class BorrowersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
  ) {}

  async list(query: { q?: string; mine?: boolean; page: number }, user: AuthUser) {
    const where: Prisma.BorrowerWhereInput = {};
    // Prisma does not escape % and _ in `contains`, so do it here.
    const q = query.q?.trim() ? escapeLike(query.q.trim()) : '';
    if (q) {
      where.OR = [
        { fullName: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { business: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }
    if (query.mine) where.officerId = user.id;

    const [total, rows] = await Promise.all([
      this.prisma.borrower.count({ where }),
      this.prisma.borrower.findMany({
        where,
        orderBy: [{ fullName: 'asc' }, { code: 'asc' }],
        skip: (query.page - 1) * BORROWERS_PAGE_SIZE,
        take: BORROWERS_PAGE_SIZE,
        include: {
          business: { select: { name: true } },
          officer: { select: { firstName: true, lastName: true } },
          loans: { where: { status: 'ACTIVE' }, select: { id: true } },
          creditScores: { orderBy: { createdAt: 'desc' }, take: 1, select: { value: true } },
        },
      }),
    ]);
    return {
      page: query.page,
      pageSize: BORROWERS_PAGE_SIZE,
      total,
      pages: Math.max(1, Math.ceil(total / BORROWERS_PAGE_SIZE)),
      items: rows.map((b) => ({
        code: b.code,
        name: b.fullName,
        type: b.type,
        businessName: b.business?.name ?? null,
        phone: maskPhone(b.phone),
        location: [b.sector, b.district].filter(Boolean).join(', '),
        kycStatus: b.kycStatus,
        riskLevel: b.riskLevel,
        score: b.creditScores[0]?.value ?? null,
        activeLoans: b.loans.length,
        officerName: short(b.officer),
      })),
    };
  }

  async profile(code: string) {
    const b = await this.prisma.borrower.findUnique({
      where: { code },
      include: {
        business: true,
        officer: { select: { firstName: true, lastName: true } },
        kycDocuments: { where: { supersededAt: null }, orderBy: { uploadedAt: 'asc' } },
        creditScores: { orderBy: { createdAt: 'desc' }, take: 12 },
        notes: {
          orderBy: { createdAt: 'desc' },
          take: 30,
          include: { author: { select: { firstName: true, lastName: true } } },
        },
        loans: {
          orderBy: { disbursedOn: 'desc' },
          include: {
            product: { select: { name: true } },
            instalments: { where: { supersededAt: null }, orderBy: { dueDate: 'asc' } },
          },
        },
      },
    });
    if (!b) throw new NotFoundException(`No borrower ${code}`);
    // Which documents have a file the officer can actually open.
    const onDisk = new Set(
      (
        await Promise.all(
          b.kycDocuments.map(async (d) =>
            (await this.uploads.locate(d.storageKey)) ? d.id : null,
          ),
        )
      ).filter(Boolean),
    );
    const today = kigaliDate();

    const owedRows = await this.prisma.$queryRaw<Array<{ owed: bigint }>>`
      SELECT COALESCE(SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE -e."amount" END), 0)::bigint AS owed
      FROM "LedgerEntry" e
      JOIN "LedgerAccount" a ON a."id" = e."accountId"
      JOIN "Loan" l ON l."id" = e."loanId"
      WHERE l."borrowerId" = ${b.id}::uuid AND a."code" = ${ACCOUNTS.LOANS_PRINCIPAL.code}`;
    const currentlyOwed = owedRows[0]?.owed ?? 0n;

    // Every instalment across every loan, oldest first.
    const cells: HistoryCell[] = [];
    let upcoming = 0;
    const all = b.loans
      .flatMap((l) => l.instalments)
      .sort((x, y) => x.dueDate.getTime() - y.dueDate.getTime());
    for (const inst of all) {
      const due = utcDateToIso(inst.dueDate);
      if (inst.status === 'PAID' && inst.paidAt)
        cells.push(paymentTiming(due, kigaliDate(inst.paidAt)));
      else if (due < today) cells.push('MISSED');
      else if (upcoming++ < UPCOMING_CELLS) cells.push('UPCOMING');
    }
    const paid = cells.filter((c) => c === 'EARLY' || c === 'ON_TIME' || c === 'LATE').length;
    const early = cells.filter((c) => c === 'EARLY').length;
    const late = cells.filter((c) => c === 'LATE').length;
    const missed = cells.filter((c) => c === 'MISSED').length;
    const dueSoFar = paid + missed;
    const loanCount = b.loans.length;
    const historySummary = dueSoFar
      ? [
          `${paid} ${paid === 1 ? 'instalment' : 'instalments'} paid across ${loanCount} ${loanCount === 1 ? 'loan' : 'loans'}`,
          missed ? `${missed} overdue now` : late ? `${late} paid late` : 'never late',
          ...(early ? [`${early} paid early`] : []),
        ].join(' · ')
      : 'No instalments due yet';

    // Scores: the latest, and how it has moved over about six months.
    const latest = b.creditScores[0] ?? null;
    const sixMonthsAgo = Date.now() - 200 * 86_400_000;
    const earlier = latest
      ? b.creditScores
          .filter((s) => s.id !== latest.id && s.createdAt.getTime() >= sixMonthsAgo)
          .at(-1)
      : undefined;
    const narrative = b.creditScores.find((s) => s.summary) ?? null;
    const note = await this.prisma.aiNote.findFirst({
      where: { kind: 'borrower_summary', borrowerId: b.id },
      orderBy: { createdAt: 'desc' },
    });
    const activeInstalments = b.loans
      .filter((l) => l.status === 'ACTIVE')
      .reduce((sum, l) => sum + l.instalmentAmount, 0n);

    const tags: Array<{
      label: string;
      tone: 'success' | 'info' | 'neutral' | 'warning' | 'danger';
    }> = [];
    tags.push(
      b.kycStatus === 'VERIFIED'
        ? { label: 'KYC verified', tone: 'success' }
        : {
            label: b.kycStatus === 'PENDING' ? 'KYC pending' : 'KYC needs attention',
            tone: 'warning',
          },
    );
    if (loanCount > 1) tags.push({ label: 'Repeat borrower', tone: 'info' });
    if (b.riskLevel) {
      tags.push({
        label: `${b.riskLevel.charAt(0)}${b.riskLevel.slice(1).toLowerCase()} risk`,
        tone: b.riskLevel === 'HIGH' ? 'danger' : b.riskLevel === 'MEDIUM' ? 'warning' : 'neutral',
      });
    }

    const subtitle = [
      b.business ? [b.business.borrowerRole, b.business.name].filter(Boolean).join(', ') : null,
      [b.sector, b.district].filter(Boolean).join(', ') || null,
      `Customer since ${formatMonthYear(utcDateToIso(b.customerSince))}`,
    ].filter(Boolean);

    return {
      code: b.code,
      name: b.fullName,
      initials: initials(b.fullName),
      firstName: b.fullName.split(' ')[0],
      subtitle,
      tags,
      score: latest
        ? {
            value: latest.value,
            label: scoreLabel(latest.value),
            percent: scorePercent(latest.value),
            updatedOn: kigaliDate(latest.createdAt),
            change: earlier ? latest.value - earlier.value : null,
          }
        : null,
      onTimeRateBps: dueSoFar ? ratioBps(BigInt(paid - late), BigInt(dueSoFar)) : null,
      debtToIncomeBps:
        b.monthlyIncome && b.monthlyIncome > 0n
          ? ratioBps(activeInstalments, b.monthlyIncome)
          : null,
      documents: b.kycDocuments.map((doc) => {
        const expires = doc.expiresOn ? utcDateToIso(doc.expiresOn) : null;
        const expiringSoon =
          expires != null &&
          expires >= today &&
          expires <= kigaliDate(new Date(Date.now() + 30 * 86_400_000));
        const expired = expires != null && expires < today;
        const reviewedOn = doc.rejectedAt ?? doc.verifiedAt;
        return {
          id: doc.id,
          type: doc.type,
          file: onDisk.has(doc.id)
            ? doc.mimeType === 'application/pdf'
              ? ('pdf' as const)
              : ('image' as const)
            : null,
          reviewable: doc.status === 'PENDING',
          reason: doc.status === 'REJECTED' ? doc.rejectionReason : null,
          name: DOC_NAMES[doc.type],
          meta: expires
            ? `${expired ? 'Expired' : 'Expires'} ${formatDate(expires)}`
            : doc.status === 'REJECTED' && reviewedOn
              ? `Rejected ${formatDate(kigaliDate(reviewedOn))}`
              : doc.verifiedVia
                ? `Verified via ${doc.verifiedVia} · ${formatMonthYear(kigaliDate(doc.verifiedAt ?? doc.uploadedAt))}`
                : `Uploaded ${formatDate(kigaliDate(doc.uploadedAt))}${doc.mimeType ? (doc.mimeType === 'application/pdf' ? ' · PDF' : ' · Photo') : ''}`,
          status: expired
            ? 'Expired'
            : expiringSoon
              ? 'Renew soon'
              : doc.status === 'VERIFIED'
                ? 'Verified'
                : doc.status === 'REJECTED'
                  ? 'Rejected'
                  : 'Pending',
          tone:
            expired || doc.status === 'REJECTED'
              ? 'danger'
              : expiringSoon || doc.status === 'PENDING'
                ? 'warning'
                : 'success',
        };
      }),
      contact: {
        phone: maskPhone(b.phone),
        nationalId: b.nationalIdLast3 ? maskNationalId(`0000000000000${b.nationalIdLast3}`) : null,
        momoLinked: b.momoLinked,
        sector: b.business?.sector ?? null,
        monthlyRevenue: b.business?.avgMonthlyRevenue ?? b.monthlyIncome,
        officerName: short(b.officer),
      },
      // Stored model output. Shown as advice, with its reasons.
      aiSummary: note
        ? {
            text: (note.content as { summary: string }).summary,
            reasons: (note.content as { reasons: Array<{ kind: 'why' | 'watch'; text: string }> })
              .reasons,
            updatedOn: kigaliDate(note.createdAt),
            modelVersion: note.model,
          }
        : narrative
          ? {
              text: narrative.summary!,
              reasons: narrative.reasons as Array<{ kind: 'why' | 'watch'; text: string }>,
              updatedOn: kigaliDate(narrative.createdAt),
              modelVersion: narrative.modelVersion,
            }
          : null,
      totals: {
        lifetimeBorrowed: b.loans.reduce((sum, l) => sum + l.principal, 0n),
        currentlyOwed,
        preApprovedLimit: b.preApprovedLimit,
      },
      loans: b.loans.map((l) => {
        const repaidEarly =
          l.status === 'REPAID' &&
          l.closedOn != null &&
          l.closedOn.getTime() < l.maturityDate.getTime();
        return {
          code: l.code,
          productName: l.product.name,
          principal: l.principal,
          period: l.disbursedOn
            ? `${formatMonthYear(utcDateToIso(l.disbursedOn))} – ${formatMonthYear(utcDateToIso(l.closedOn ?? l.maturityDate))}`
            : 'Not disbursed yet',
          status: l.status,
          statusLabel:
            l.status === 'ACTIVE'
              ? 'Active'
              : l.status === 'REPAID'
                ? repaidEarly
                  ? 'Repaid early'
                  : 'Repaid'
                : l.status === 'WRITTEN_OFF'
                  ? 'Written off'
                  : 'Pending',
        };
      }),
      history: { cells, summary: historySummary },
      notes: b.notes.map((n) => ({
        id: n.id,
        body: n.body,
        author: short(n.author),
        createdOn: kigaliDate(n.createdAt),
      })),
    };
  }

  async addNote(code: string, body: string, user: AuthUser, meta: RequestMeta) {
    const text = body.trim();
    if (!text) throw new BadRequestException('Write something first');
    const borrower = await this.prisma.borrower.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!borrower) throw new NotFoundException(`No borrower ${code}`);
    await this.prisma.$transaction(async (tx) => {
      const note = await tx.note.create({
        data: { borrowerId: borrower.id, authorId: user.id, body: text },
      });
      await this.audit.record(
        {
          action: 'borrower.note.add',
          actorId: user.id,
          entityType: 'Borrower',
          entityId: code,
          // The note's text stays out of the audit trail; it may hold personal details.
          metadata: { noteId: note.id, length: text.length },
          ...meta,
        },
        tx,
      );
    });
    return this.profile(code);
  }
}
