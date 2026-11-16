import { ConflictException, Injectable } from '@nestjs/common';
import { isoToUtcDate, type IsoDate } from '@kora/core';
import type { LedgerTransactionType, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requireCompanyId } from '../tenancy/company-context';
import { ACCOUNTS, type AccountKey } from './accounts';
import { balancedLines, type PostingLine } from './posting';

export interface LedgerPosting {
  type: LedgerTransactionType;
  /** Unique per business event. Posting the same key twice is refused. */
  idempotencyKey: string;
  loanId?: string | null;
  effectiveOn: IsoDate;
  memo?: string;
  lines: PostingLine[];
  postedById?: string | null;
}

/**
 * The only way balances change. Every posting is checked here, and again by
 * the database triggers when the surrounding transaction commits.
 */
@Injectable()
export class LedgerService {
  /** Account ids per company: every company has its own chart of accounts. */
  private readonly accountIds = new Map<string, Map<AccountKey, string>>();

  constructor(private readonly prisma: PrismaService) {}

  /** Post inside the caller's transaction, so the money and its cause commit together. */
  async post(tx: Prisma.TransactionClient, posting: LedgerPosting): Promise<string> {
    const lines = balancedLines(posting.lines);
    const accounts = await this.accounts();
    const loanId = posting.loanId ?? null;
    try {
      const created = await tx.ledgerTransaction.create({
        data: {
          type: posting.type,
          idempotencyKey: posting.idempotencyKey,
          loanId,
          memo: posting.memo,
          effectiveOn: isoToUtcDate(posting.effectiveOn),
          postedById: posting.postedById ?? null,
          entries: {
            create: lines.map((line) => ({
              accountId: accounts.get(line.account)!,
              // Principal and interest receivables carry the loan id so a
              // loan's balances are plain sums over its entries.
              loanId:
                line.account === 'LOANS_PRINCIPAL' || line.account === 'INTEREST_RECEIVABLE'
                  ? loanId
                  : null,
              direction: line.direction,
              amount: line.amount,
            })),
          },
        },
        select: { id: true },
      });
      return created.id;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('This transaction has already been posted');
      }
      throw err;
    }
  }

  /** Outstanding principal on one loan: debits less credits on its receivable. */
  async outstandingPrincipal(
    loanId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<bigint> {
    return this.loanBalance(loanId, ACCOUNTS.LOANS_PRINCIPAL.code, db);
  }

  /** Accrued interest not yet collected on one loan. */
  async outstandingInterestReceivable(
    loanId: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<bigint> {
    return this.loanBalance(loanId, ACCOUNTS.INTEREST_RECEIVABLE.code, db);
  }

  /**
   * Credit balance on the loan-loss allowance (contra-asset). The amount
   * already set aside against the portfolio under BNR 59/2023.
   */
  async loanLossAllowance(db: Prisma.TransactionClient = this.prisma): Promise<bigint> {
    const rows = await db.$queryRaw<Array<{ balance: bigint }>>`
      SELECT COALESCE(SUM(CASE WHEN e."direction" = 'CREDIT' THEN e."amount" ELSE -e."amount" END), 0)::bigint AS balance
      FROM "LedgerEntry" e
      JOIN "LedgerAccount" a ON a."id" = e."accountId"
      WHERE a."code" = ${ACCOUNTS.LOAN_LOSS_ALLOWANCE.code}`;
    return rows[0]?.balance ?? 0n;
  }

  private async loanBalance(
    loanId: string,
    accountCode: string,
    db: Prisma.TransactionClient,
  ): Promise<bigint> {
    const rows = await db.$queryRaw<Array<{ outstanding: bigint }>>`
      SELECT COALESCE(SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE -e."amount" END), 0)::bigint AS outstanding
      FROM "LedgerEntry" e
      JOIN "LedgerAccount" a ON a."id" = e."accountId"
      WHERE e."loanId" = ${loanId}::uuid AND a."code" = ${accountCode}`;
    return rows[0]?.outstanding ?? 0n;
  }

  private async accounts(): Promise<Map<AccountKey, string>> {
    const companyId = requireCompanyId();
    const cached = this.accountIds.get(companyId);
    if (cached) return cached;
    const rows = await this.prisma.ledgerAccount.findMany({ select: { id: true, code: true } });
    const byCode = new Map(rows.map((r) => [r.code, r.id]));
    const map = new Map<AccountKey, string>();
    for (const key of Object.keys(ACCOUNTS) as AccountKey[]) {
      const id = byCode.get(ACCOUNTS[key].code);
      if (!id) throw new Error(`Ledger account ${ACCOUNTS[key].code} is missing for this company`);
      map.set(key, id);
    }
    this.accountIds.set(companyId, map);
    return map;
  }
}
