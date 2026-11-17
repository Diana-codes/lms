import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  annualRateBps,
  type IsoDate,
  kigaliDate,
  type LoanQuote,
  type LoanTerms,
  RW_DEFAULT_TERMS,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import { Prisma, type Product } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProductInput, UpdateProductInput } from './products.schemas';
import { productTerms, quoteFor } from './terms';

const limitsOf = (
  p: Pick<Product, 'minAmount' | 'maxAmount' | 'minTermMonths' | 'maxTermMonths'>,
) => ({
  minAmount: p.minAmount.toString(),
  maxAmount: p.maxAmount.toString(),
  minTermMonths: p.minTermMonths,
  maxTermMonths: p.maxTermMonths,
});

/** A quote as plain JSON (bigints as digit strings, via the global serializer). */
export function quoteView(q: LoanQuote) {
  return {
    amount: q.amount,
    principal: q.principal,
    netDisbursed: q.netDisbursed,
    instalment: q.instalment,
    instalmentCount: q.rows.length,
    totalInterest: q.totalInterest,
    totalFees: q.totalFees,
    totalThirdParty: q.totalThirdParty,
    totalVat: q.totalVat,
    totalCostOfCredit: q.totalCostOfCredit,
    totalRepayable: q.totalRepayable,
    aprBps: q.aprBps,
    effectiveAnnualBps: q.effectiveAnnualBps,
    fees: q.fees,
    rows: q.rows,
  };
}

/**
 * Loan products, managed by each company's administrators. Terms are
 * versioned: every change to the terms or limits creates a new version, and
 * loans record the version they were issued under.
 */
@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Published products, for application forms. */
  async published() {
    const products = await this.prisma.product.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { name: 'asc' },
    });
    return products.map((p) => {
      const terms = productTerms(p);
      return {
        code: p.code,
        name: p.name,
        shortName: p.shortName,
        kind: p.kind,
        annualRateBps: p.annualRateBps,
        rateBps: terms.rateBps,
        ratePeriod: terms.ratePeriod,
        interestMethod: terms.interestMethod,
        frequency: terms.frequency,
        minTermMonths: p.minTermMonths,
        maxTermMonths: p.maxTermMonths,
        minAmount: p.minAmount,
        maxAmount: p.maxAmount,
        affordabilityBps: p.affordabilityBps,
        secondApprovalAbove: p.secondApprovalAbove,
      };
    });
  }

  /**
   * The public loan catalogue for the company's website: what anyone may see
   * before signing in. A worked example per product shows the instalment and
   * the APR (the full cost, fees included) for a typical amount and term.
   */
  async catalogue() {
    const products = await this.prisma.product.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { minAmount: 'asc' },
    });
    return products.map((p) => {
      const terms = productTerms(p);
      // A typical size: the geometric middle of the range (RWF 5M for 0.5–50M).
      const amount = roundExample(
        BigInt(Math.round(Math.sqrt(Number(p.minAmount) * Number(p.maxAmount)))),
      );
      const termMonths = Math.max(
        p.minTermMonths,
        Math.min(p.maxTermMonths, Math.round((p.minTermMonths + p.maxTermMonths) / 2)),
      );
      let example = null;
      try {
        const q = quoteFor({ amount, termMonths, terms, disbursedOn: kigaliDate() });
        example = {
          amount,
          termMonths,
          instalment: q.instalment,
          instalmentCount: q.rows.length,
          totalToRepay: q.totalRepayable,
          aprBps: q.aprBps,
        };
      } catch {
        // A product whose terms cannot be quoted is still listed, without the example.
      }
      return {
        code: p.code,
        name: p.name,
        shortName: p.shortName,
        kind: p.kind,
        description: p.description,
        minAmount: p.minAmount,
        maxAmount: p.maxAmount,
        minTermMonths: p.minTermMonths,
        maxTermMonths: p.maxTermMonths,
        rateBps: terms.rateBps,
        ratePeriod: terms.ratePeriod,
        interestMethod: terms.interestMethod,
        frequency: terms.frequency,
        requiredDocuments: p.requiredDocuments,
        example,
      };
    });
  }

  /** Every product, for the products screen. */
  async all() {
    const products = await this.prisma.product.findMany({
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { loans: { where: { status: 'ACTIVE' } } } } },
    });
    return products.map((p) => ({
      code: p.code,
      name: p.name,
      shortName: p.shortName,
      kind: p.kind,
      status: p.status,
      version: p.version,
      annualRateBps: p.annualRateBps,
      terms: productTerms(p),
      ...limitsOf(p),
      activeLoans: p._count.loans,
      updatedAt: p.updatedAt,
    }));
  }

  async detail(code: string) {
    const p = await this.prisma.product.findFirst({
      where: { code },
      include: {
        versions: { orderBy: { version: 'desc' } },
        _count: { select: { loans: true, applications: true } },
      },
    });
    if (!p) throw new NotFoundException(`No product ${code}`);
    return {
      code: p.code,
      name: p.name,
      shortName: p.shortName,
      description: p.description,
      kind: p.kind,
      status: p.status,
      version: p.version,
      terms: productTerms(p),
      ...limitsOf(p),
      affordabilityBps: p.affordabilityBps,
      autoApproveMinScore: p.autoApproveMinScore,
      autoApproveMaxAmount: p.autoApproveMaxAmount,
      secondApprovalAbove: p.secondApprovalAbove,
      loans: p._count.loans,
      applications: p._count.applications,
      versions: p.versions.map((v) => ({
        version: v.version,
        createdAt: v.createdAt,
        terms: v.terms,
        limits: v.limits,
      })),
    };
  }

  async create(input: CreateProductInput, actorId: string, meta: RequestMeta) {
    const terms: LoanTerms = (input.terms as LoanTerms | undefined) ?? RW_DEFAULT_TERMS;
    try {
      const product = await this.prisma.product.create({
        data: {
          code: input.code,
          name: input.name,
          shortName: input.shortName,
          description: input.description ?? null,
          kind: input.kind,
          status: 'DRAFT',
          terms: terms as object,
          annualRateBps: annualRateBps(terms),
          minAmount: input.minAmount,
          maxAmount: input.maxAmount,
          minTermMonths: input.minTermMonths,
          maxTermMonths: input.maxTermMonths,
          affordabilityBps: input.affordabilityBps,
          autoApproveMinScore: input.autoApproveMinScore ?? null,
          autoApproveMaxAmount: input.autoApproveMaxAmount ?? null,
          secondApprovalAbove: input.secondApprovalAbove ?? null,
          versions: {
            create: {
              version: 1,
              terms: terms as object,
              limits: limitsOf(input),
              createdById: actorId,
            },
          },
        },
      });
      await this.record('product.create', product.code, actorId, meta, { version: 1 });
      return this.detail(product.code);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`A product already uses the code ${input.code}`);
      }
      throw err;
    }
  }

  /** Change a product. New terms or limits make a new version; existing loans keep theirs. */
  async update(code: string, input: UpdateProductInput, actorId: string, meta: RequestMeta) {
    const p = await this.prisma.product.findFirst({ where: { code } });
    if (!p) throw new NotFoundException(`No product ${code}`);
    if (p.status === 'RETIRED') throw new ConflictException('A retired product cannot be changed');

    const next = {
      minAmount: input.minAmount ?? p.minAmount,
      maxAmount: input.maxAmount ?? p.maxAmount,
      minTermMonths: input.minTermMonths ?? p.minTermMonths,
      maxTermMonths: input.maxTermMonths ?? p.maxTermMonths,
    };
    if (next.minAmount > next.maxAmount) {
      throw new BadRequestException('The smallest amount is above the largest');
    }
    if (next.minTermMonths > next.maxTermMonths) {
      throw new BadRequestException('The shortest term is longer than the longest');
    }
    const terms = (input.terms as LoanTerms | undefined) ?? productTerms(p);
    const termsChanged =
      input.terms != null && JSON.stringify(input.terms) !== JSON.stringify(p.terms);
    const limitsChanged = JSON.stringify(limitsOf(next)) !== JSON.stringify(limitsOf(p));
    const version = termsChanged || limitsChanged ? p.version + 1 : p.version;

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.updateMany({
        where: { id: p.id, version: p.version },
        data: {
          name: input.name,
          shortName: input.shortName,
          description: input.description,
          kind: input.kind,
          terms: terms as object,
          annualRateBps: annualRateBps(terms),
          ...next,
          version,
          affordabilityBps: input.affordabilityBps,
          autoApproveMinScore: input.autoApproveMinScore,
          autoApproveMaxAmount: input.autoApproveMaxAmount,
          secondApprovalAbove: input.secondApprovalAbove,
        },
      });
      if (updated.count !== 1)
        throw new ConflictException('Someone else just changed this product');
      if (version !== p.version) {
        await tx.productVersion.create({
          data: {
            productId: p.id,
            version,
            terms: terms as object,
            limits: limitsOf(next),
            createdById: actorId,
          },
        });
      }
    });
    await this.record('product.update', code, actorId, meta, {
      version,
      changes: Object.keys(input),
    });
    return this.detail(code);
  }

  async setStatus(
    code: string,
    status: 'PUBLISHED' | 'RETIRED',
    actorId: string,
    meta: RequestMeta,
  ) {
    const p = await this.prisma.product.findFirst({ where: { code } });
    if (!p) throw new NotFoundException(`No product ${code}`);
    if (status === 'PUBLISHED' && p.status === 'RETIRED') {
      throw new ConflictException('A retired product cannot be published again. Copy it instead.');
    }
    await this.prisma.product.update({ where: { id: p.id }, data: { status } });
    await this.record(
      status === 'PUBLISHED' ? 'product.publish' : 'product.retire',
      code,
      actorId,
      meta,
      {
        version: p.version,
      },
    );
    return this.detail(code);
  }

  /** A sample loan under some terms: for the product editor's preview. */
  quote(input: { terms: LoanTerms; amount: bigint; termMonths: number; disbursedOn?: IsoDate }) {
    try {
      return quoteView(
        quoteFor({
          amount: input.amount,
          termMonths: input.termMonths,
          terms: input.terms,
          disbursedOn: input.disbursedOn ?? kigaliDate(),
        }),
      );
    } catch (err) {
      if (err instanceof RangeError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  private record(
    action: string,
    code: string,
    actorId: string,
    meta: RequestMeta,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record({
      action,
      actorId,
      entityType: 'Product',
      entityId: code,
      metadata,
      ...meta,
    });
  }
}

/** Example amounts read better in round figures: 2 significant digits (at least 50,000 RWF). */
function roundExample(amount: bigint): bigint {
  let step = 1n;
  while (amount / step >= 100n) step *= 10n;
  const r = ((amount + step / 2n) / step) * step;
  return r < 50_000n ? 50_000n : r;
}
