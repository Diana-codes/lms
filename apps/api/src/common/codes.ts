import type { Prisma } from '../generated/prisma/client';

/**
 * Take the next number for a reference series. One atomic statement, so two
 * requests can never be handed the same number. Call it inside the same
 * transaction that creates the record. Each company has its own series: the
 * row's companyId comes from the connection's company.
 */
export async function nextNumber(tx: Prisma.TransactionClient, key: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO "CodeCounter" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("companyId", "key") DO UPDATE SET "value" = "CodeCounter"."value" + 1
    RETURNING "value"`;
  return rows[0]!.value;
}

export const nextApplicationCode = async (tx: Prisma.TransactionClient) =>
  `APP-${await nextNumber(tx, 'APP')}`;

export const nextBorrowerCode = async (tx: Prisma.TransactionClient) =>
  `BR-${String(await nextNumber(tx, 'BR')).padStart(5, '0')}`;

/** LN-0418-2026: a running number within the year of disbursement. */
export const nextLoanCode = async (tx: Prisma.TransactionClient, year: string) =>
  `LN-${String(await nextNumber(tx, `LN-${year}`)).padStart(4, '0')}-${year}`;
