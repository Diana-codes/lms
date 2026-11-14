import {
  COMPONENTS,
  FEE_TIMINGS,
  FREQUENCIES,
  INTEREST_METHODS,
  OVERPAYMENT_RULES,
  PAYOFF_INTEREST_RULES,
  PENALTY_METHODS,
  PRODUCT_KINDS,
  RATE_PERIODS,
  ROUNDING_UNITS,
  termsProblems,
  type LoanTerms,
} from '@kora/core';
import { z } from 'zod';

const int = (min: number, max: number) => z.number().int().min(min).max(max);
const rwf = z
  .union([z.string().regex(/^\d+$/), z.number().int().nonnegative()])
  .transform((v) => BigInt(v));

const feeSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, 'Use lowercase letters, digits, - or _'),
  name: z.string().trim().min(1).max(60),
  basis: z.enum(['PERCENT', 'FIXED']),
  value: int(0, 1_000_000_000),
  min: int(0, 1_000_000_000).nullable().optional(),
  max: int(0, 1_000_000_000).nullable().optional(),
  timing: z.enum(FEE_TIMINGS),
  thirdParty: z.boolean(),
  vat: z.boolean(),
});

/** LoanTerms from the outside world: shape here, then the engine's own consistency checks. */
export const termsSchema = z
  .object({
    interestMethod: z.enum(INTEREST_METHODS),
    rateBps: int(0, 100_000),
    ratePeriod: z.enum(RATE_PERIODS),
    frequency: z.enum(FREQUENCIES),
    dueDayOfMonth: int(1, 28).nullable(),
    moveOffNonWorkingDays: z.boolean(),
    principalGracePeriods: int(0, 120),
    fees: z.array(feeSchema).max(10),
    vatBps: int(0, 10_000),
    penalty: z.object({
      method: z.enum(PENALTY_METHODS),
      graceDays: int(0, 365),
      amount: int(0, 1_000_000_000),
      bps: int(0, 100_000),
      capBps: int(0, 100_000).nullable(),
    }),
    allocationOrder: z.array(z.enum(COMPONENTS)).length(4),
    overpayment: z.enum(OVERPAYMENT_RULES),
    payoff: z.object({
      interest: z.enum(PAYOFF_INTEREST_RULES),
      feeBps: int(0, 10_000),
      feeVat: z.boolean(),
    }),
    roundingUnit: z.union(
      ROUNDING_UNITS.map((u) => z.literal(u)) as [z.ZodLiteral<1>, ...z.ZodLiteral<number>[]],
    ),
  })
  .superRefine((terms, ctx) => {
    for (const problem of termsProblems(terms as LoanTerms)) {
      ctx.addIssue({ code: 'custom', message: problem });
    }
  });

const limits = {
  minAmount: rwf,
  maxAmount: rwf,
  minTermMonths: int(1, 360),
  maxTermMonths: int(1, 360),
};

const approvals = {
  affordabilityBps: int(0, 10_000).optional(),
  autoApproveMinScore: int(300, 850).nullable().optional(),
  autoApproveMaxAmount: rwf.nullable().optional(),
  secondApprovalAbove: rwf.nullable().optional(),
};

const checkLimits = (
  p: { minAmount?: bigint; maxAmount?: bigint; minTermMonths?: number; maxTermMonths?: number },
  ctx: z.RefinementCtx,
) => {
  if (p.minAmount != null && p.maxAmount != null && p.minAmount > p.maxAmount) {
    ctx.addIssue({ code: 'custom', message: 'The smallest amount is above the largest' });
  }
  if (p.minAmount != null && p.minAmount <= 0n) {
    ctx.addIssue({ code: 'custom', message: 'The smallest amount must be above zero' });
  }
  if (p.minTermMonths != null && p.maxTermMonths != null && p.minTermMonths > p.maxTermMonths) {
    ctx.addIssue({ code: 'custom', message: 'The shortest term is longer than the longest' });
  }
};

export const createProductSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, 'Use 2–20 capital letters, digits or hyphens'),
    name: z.string().trim().min(2).max(80),
    shortName: z.string().trim().min(1).max(20),
    description: z.string().trim().max(500).nullable().optional(),
    kind: z.enum(PRODUCT_KINDS),
    terms: termsSchema.optional(),
    ...limits,
    ...approvals,
  })
  .superRefine(checkLimits);

export const updateProductSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    shortName: z.string().trim().min(1).max(20).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    kind: z.enum(PRODUCT_KINDS).optional(),
    terms: termsSchema.optional(),
    minAmount: rwf.optional(),
    maxAmount: rwf.optional(),
    minTermMonths: int(1, 360).optional(),
    maxTermMonths: int(1, 360).optional(),
    ...approvals,
  })
  .strict()
  .superRefine(checkLimits);

export const quoteSchema = z.object({
  terms: termsSchema,
  amount: rwf.refine((v) => v > 0n, 'Enter an amount'),
  termMonths: int(1, 360),
  disbursedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
