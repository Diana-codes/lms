import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  COLLATERAL_KIND_LABELS,
  type CollateralKind,
  COLLATERAL_KINDS,
  isoToUtcDate,
  totalAdmissibleCollateral,
  utcDateToIso,
  type IsoDate,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AddCollateralInput {
  kind: CollateralKind;
  description: string;
  marketValue: bigint;
  registered?: boolean;
  insured?: boolean;
  valuedOn?: IsoDate | null;
  valuerName?: string | null;
  documentRef?: string | null;
}

export interface AddGuarantorInput {
  fullName: string;
  phone?: string | null;
  nationalIdLast3?: string | null;
  relationship?: string | null;
  guaranteeAmount?: bigint | null;
  notes?: string | null;
}

const activeCollateral = { releasedAt: null as Date | null };

/**
 * Collateral and guarantors on a loan. Collateral of admissible kinds
 * reduces the BNR 59/2023 provision base (Art. 19); guarantors are for
 * recovery and disclosure only.
 */
@Injectable()
export class LoanSecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Deductible collateral value for provisioning (Art. 19 haircuts applied). */
  async admissibleForLoan(
    loanId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<bigint> {
    const rows = await db.loanCollateral.findMany({
      where: { loanId, ...activeCollateral },
      select: { kind: true, marketValue: true, registered: true, insured: true },
    });
    return totalAdmissibleCollateral(
      rows.map((r) => ({
        kind: r.kind as CollateralKind,
        marketValue: r.marketValue,
        registered: r.registered,
        insured: r.insured,
      })),
    );
  }

  async addCollateral(
    loanCode: string,
    input: AddCollateralInput,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const loan = await this.requireOpenLoan(loanCode);
    if (!COLLATERAL_KINDS.includes(input.kind)) {
      throw new ConflictException('Unknown collateral kind');
    }
    if (input.marketValue < 0n) throw new ConflictException('Market value cannot be negative');

    const row = await this.prisma.loanCollateral.create({
      data: {
        loanId: loan.id,
        kind: input.kind,
        description: input.description.trim(),
        marketValue: input.marketValue,
        registered: input.registered ?? false,
        insured: input.insured ?? false,
        valuedOn: input.valuedOn ? isoToUtcDate(input.valuedOn) : null,
        valuerName: input.valuerName?.trim() || null,
        documentRef: input.documentRef?.trim() || null,
      },
    });
    await this.syncSummary(loan.id);
    await this.audit.record({
      action: 'loan.collateral.add',
      actorId: user.id,
      entityType: 'Loan',
      entityId: loan.code,
      metadata: {
        collateralId: row.id,
        kind: row.kind,
        marketValue: row.marketValue,
      },
      ...meta,
    });
    return this.serializeCollateral(row);
  }

  async releaseCollateral(
    loanCode: string,
    collateralId: string,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const loan = await this.requireOpenLoan(loanCode);
    const existing = await this.prisma.loanCollateral.findFirst({
      where: { id: collateralId, loanId: loan.id },
    });
    if (!existing) throw new NotFoundException('No such collateral on this loan');
    if (existing.releasedAt) throw new ConflictException('This collateral is already released');

    await this.prisma.loanCollateral.update({
      where: { id: collateralId },
      data: { releasedAt: new Date() },
    });
    await this.syncSummary(loan.id);
    await this.audit.record({
      action: 'loan.collateral.release',
      actorId: user.id,
      entityType: 'Loan',
      entityId: loan.code,
      metadata: { collateralId, kind: existing.kind },
      ...meta,
    });
    return { ok: true };
  }

  async addGuarantor(
    loanCode: string,
    input: AddGuarantorInput,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const loan = await this.requireOpenLoan(loanCode);
    const row = await this.prisma.loanGuarantor.create({
      data: {
        loanId: loan.id,
        fullName: input.fullName.trim(),
        phone: input.phone?.trim() || null,
        nationalIdLast3: input.nationalIdLast3?.trim() || null,
        relationship: input.relationship?.trim() || null,
        guaranteeAmount: input.guaranteeAmount ?? null,
        notes: input.notes?.trim() || null,
      },
    });
    await this.audit.record({
      action: 'loan.guarantor.add',
      actorId: user.id,
      entityType: 'Loan',
      entityId: loan.code,
      metadata: { guarantorId: row.id, fullName: row.fullName },
      ...meta,
    });
    return this.serializeGuarantor(row);
  }

  async releaseGuarantor(
    loanCode: string,
    guarantorId: string,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const loan = await this.requireOpenLoan(loanCode);
    const existing = await this.prisma.loanGuarantor.findFirst({
      where: { id: guarantorId, loanId: loan.id },
    });
    if (!existing) throw new NotFoundException('No such guarantor on this loan');
    if (existing.releasedAt) throw new ConflictException('This guarantor is already released');

    await this.prisma.loanGuarantor.update({
      where: { id: guarantorId },
      data: { releasedAt: new Date() },
    });
    await this.audit.record({
      action: 'loan.guarantor.release',
      actorId: user.id,
      entityType: 'Loan',
      entityId: loan.code,
      metadata: { guarantorId, fullName: existing.fullName },
      ...meta,
    });
    return { ok: true };
  }

  serializeCollateral(row: {
    id: string;
    kind: string;
    description: string;
    marketValue: bigint;
    registered: boolean;
    insured: boolean;
    valuedOn: Date | null;
    valuerName: string | null;
    documentRef: string | null;
    releasedAt: Date | null;
  }) {
    const kind = row.kind as CollateralKind;
    return {
      id: row.id,
      kind,
      kindLabel: COLLATERAL_KIND_LABELS[kind] ?? kind,
      description: row.description,
      marketValue: row.marketValue,
      registered: row.registered,
      insured: row.insured,
      valuedOn: row.valuedOn ? utcDateToIso(row.valuedOn) : null,
      valuerName: row.valuerName,
      documentRef: row.documentRef,
      released: row.releasedAt != null,
    };
  }

  serializeGuarantor(row: {
    id: string;
    fullName: string;
    phone: string | null;
    nationalIdLast3: string | null;
    relationship: string | null;
    guaranteeAmount: bigint | null;
    notes: string | null;
    releasedAt: Date | null;
  }) {
    return {
      id: row.id,
      fullName: row.fullName,
      phone: row.phone,
      nationalIdLast3: row.nationalIdLast3,
      relationship: row.relationship,
      guaranteeAmount: row.guaranteeAmount,
      notes: row.notes,
      released: row.releasedAt != null,
    };
  }

  private async requireOpenLoan(code: string) {
    const loan = await this.prisma.loan.findFirst({ where: { code } });
    if (!loan) throw new NotFoundException(`No loan ${code}`);
    if (loan.status === 'REPAID' || loan.status === 'WRITTEN_OFF') {
      throw new ConflictException('This loan is closed');
    }
    return loan;
  }

  /** Refresh Loan.collateral from active structured rows (for KFS / lists). */
  private async syncSummary(loanId: string) {
    const rows = await this.prisma.loanCollateral.findMany({
      where: { loanId, ...activeCollateral },
      orderBy: { createdAt: 'asc' },
      select: { kind: true, description: true },
    });
    const summary =
      rows.length === 0
        ? null
        : rows
            .map((r) => {
              const label = COLLATERAL_KIND_LABELS[r.kind as CollateralKind] ?? r.kind;
              return r.description.trim() || label;
            })
            .join('; ')
            .slice(0, 120);
    await this.prisma.loan.update({
      where: { id: loanId },
      data: { collateral: summary },
    });
  }
}
