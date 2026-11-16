import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type AccountTotals,
  type AccountType,
  addDays,
  addMonths,
  balanceSheet,
  incomeStatement,
  type IsoDate,
  isoToUtcDate,
  journalProblem,
  kigaliDate,
  monthEnd,
  monthStart,
  trialBalance,
  utcDateToIso,
} from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { nextNumber } from '../common/codes';
import type { JournalKind, LedgerAccountType } from '../generated/prisma/client';
import { ACCOUNTS, CASH_ACCOUNT_KEYS, CONTROL_ACCOUNT_CODES } from '../ledger/accounts';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { requireCompanyId } from '../tenancy/company-context';

export interface JournalLineIn {
  accountCode: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: bigint;
  note?: string;
}

interface StoredLine {
  accountCode: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string;
  note?: string;
}

const userName = { select: { firstName: true, lastName: true } } as const;

/**
 * The books beyond the loan engine (PRD §10): the chart of accounts, manual
 * journals with maker-checker approval, accounting periods, and the trial
 * balance, income statement and balance sheet, all derived from the ledger.
 */
@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  // ── chart of accounts ────────────────────────────────────────────────

  async accounts(asOf: IsoDate = kigaliDate()) {
    const totals = await this.totals({ to: asOf });
    const all = await this.prisma.ledgerAccount.findMany({ orderBy: { code: 'asc' } });
    const byCode = new Map(totals.map((t) => [t.code, t]));
    return all.map((a) => {
      const t = byCode.get(a.code);
      return {
        code: a.code,
        name: a.name,
        type: a.type,
        system: a.system,
        isActive: a.isActive,
        description: a.description,
        control: CONTROL_ACCOUNT_CODES.has(a.code),
        debits: t?.debits ?? 0n,
        credits: t?.credits ?? 0n,
      };
    });
  }

  async addAccount(
    input: { code: string; name: string; type: LedgerAccountType; description?: string | null },
    user: AuthUser,
    meta: RequestMeta,
  ) {
    if (!sameRange(input.code, input.type)) {
      throw new BadRequestException(
        `${input.type.toLowerCase()} account codes start with ${RANGE[input.type]}`,
      );
    }
    try {
      const created = await this.prisma.ledgerAccount.create({
        data: {
          code: input.code,
          name: input.name.trim(),
          type: input.type,
          description: input.description?.trim() || null,
          system: false,
        },
      });
      await this.audit.record({
        action: 'accounting.account.create',
        actorId: user.id,
        entityType: 'LedgerAccount',
        entityId: created.code,
        metadata: { name: created.name, type: created.type },
        ...meta,
      });
      return created;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException(`Account ${input.code} already exists`);
      }
      throw err;
    }
  }

  async updateAccount(
    code: string,
    input: { name?: string; isActive?: boolean; description?: string | null },
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const account = await this.prisma.ledgerAccount.findFirst({ where: { code } });
    if (!account) throw new NotFoundException(`No account ${code}`);
    if (account.system && input.isActive === false) {
      throw new ConflictException('Built-in accounts cannot be switched off');
    }
    const updated = await this.prisma.ledgerAccount.update({
      where: { id: account.id },
      data: {
        name: input.name?.trim() || undefined,
        isActive: input.isActive,
        description:
          input.description === undefined ? undefined : input.description?.trim() || null,
      },
    });
    await this.audit.record({
      action: 'accounting.account.update',
      actorId: user.id,
      entityType: 'LedgerAccount',
      entityId: code,
      metadata: { changes: Object.keys(input) },
      ...meta,
    });
    return updated;
  }

  // ── manual journals ─────────────────────────────────────────────────

  async journals(status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    const rows = await this.prisma.journalEntry.findMany({
      where: status ? { status } : {},
      orderBy: { requestedAt: 'desc' },
      take: 200,
    });
    const people = await this.names(
      rows.flatMap((r) => [r.requestedById, r.decidedById].filter((x): x is string => !!x)),
    );
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      kind: r.kind,
      effectiveOn: utcDateToIso(r.effectiveOn),
      memo: r.memo,
      lines: r.lines as unknown as StoredLine[],
      total: r.total,
      status: r.status,
      requestedById: r.requestedById,
      requestedBy: people.get(r.requestedById) ?? null,
      requestedAt: r.requestedAt.toISOString(),
      decidedBy: r.decidedById ? (people.get(r.decidedById) ?? null) : null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      rejectReason: r.rejectReason,
    }));
  }

  /** Draft a journal. It posts only when someone else approves it. */
  async createJournal(
    input: { kind: JournalKind; effectiveOn: IsoDate; memo: string; lines: JournalLineIn[] },
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const problem = journalProblem(input.lines);
    if (problem) throw new BadRequestException(problem);
    if (input.effectiveOn > kigaliDate()) {
      throw new BadRequestException('A journal cannot be dated in the future');
    }
    await this.assertOpen(input.effectiveOn);
    await this.assertPostable(input.lines.map((l) => l.accountCode));
    const total = input.lines
      .filter((l) => l.direction === 'DEBIT')
      .reduce((s, l) => s + l.amount, 0n);

    const journal = await this.prisma.$transaction(async (tx) => {
      const code = `JV-${String(await nextNumber(tx, 'JV')).padStart(5, '0')}`;
      const created = await tx.journalEntry.create({
        data: {
          code,
          kind: input.kind,
          effectiveOn: isoToUtcDate(input.effectiveOn),
          memo: input.memo.trim(),
          lines: input.lines.map((l) => ({
            accountCode: l.accountCode,
            direction: l.direction,
            amount: l.amount.toString(),
            ...(l.note?.trim() ? { note: l.note.trim() } : {}),
          })),
          total,
          requestedById: user.id,
        },
      });
      await this.audit.record(
        {
          action: 'accounting.journal.create',
          actorId: user.id,
          entityType: 'JournalEntry',
          entityId: code,
          metadata: { kind: input.kind, total: total.toString(), effectiveOn: input.effectiveOn },
          ...meta,
        },
        tx,
      );
      return created;
    });
    return { code: journal.code, status: journal.status };
  }

  /** Convenience for the commonest journal: an expense paid from a cash account. */
  async recordExpense(
    input: {
      expenseAccount: string;
      paidFrom: (typeof CASH_ACCOUNT_KEYS)[number] | 'ACCRUED_EXPENSES';
      amount: bigint;
      effectiveOn: IsoDate;
      memo: string;
    },
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const expense = await this.prisma.ledgerAccount.findFirst({
      where: { code: input.expenseAccount },
    });
    if (!expense || expense.type !== 'EXPENSE') {
      throw new BadRequestException('Choose an expense account');
    }
    return this.createJournal(
      {
        kind: 'EXPENSE',
        effectiveOn: input.effectiveOn,
        memo: input.memo,
        lines: [
          { accountCode: expense.code, direction: 'DEBIT', amount: input.amount },
          {
            accountCode: ACCOUNTS[input.paidFrom].code,
            direction: 'CREDIT',
            amount: input.amount,
          },
        ],
      },
      user,
      meta,
    );
  }

  async decideJournal(
    code: string,
    approve: boolean,
    reason: string | undefined,
    user: AuthUser,
    meta: RequestMeta,
  ) {
    const journal = await this.prisma.journalEntry.findFirst({ where: { code } });
    if (!journal) throw new NotFoundException(`No journal ${code}`);
    if (journal.requestedById === user.id) {
      throw new ForbiddenException('Someone other than the person who drafted it must decide this');
    }
    if (!approve && !reason?.trim()) throw new BadRequestException('Give a reason for rejecting');
    const effectiveOn = utcDateToIso(journal.effectiveOn);
    const lines = journal.lines as unknown as StoredLine[];
    if (approve) {
      await this.assertOpen(effectiveOn);
      await this.assertPostable(lines.map((l) => l.accountCode));
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.journalEntry.updateMany({
        where: { id: journal.id, status: 'PENDING' },
        data: {
          status: approve ? 'APPROVED' : 'REJECTED',
          decidedById: user.id,
          decidedAt: new Date(),
          rejectReason: approve ? null : reason!.trim(),
        },
      });
      if (claimed.count !== 1) throw new ConflictException('This journal has already been decided');
      if (approve) {
        const txId = await this.ledger.postByCode(tx, {
          type: 'JOURNAL',
          idempotencyKey: `journal:${journal.id}`,
          effectiveOn,
          memo: `${journal.code}: ${journal.memo}`,
          postedById: user.id,
          lines: lines.map((l) => ({
            code: l.accountCode,
            direction: l.direction,
            amount: BigInt(l.amount),
          })),
        });
        await tx.journalEntry.update({
          where: { id: journal.id },
          data: { ledgerTransactionId: txId },
        });
      }
      await this.audit.record(
        {
          action: approve ? 'accounting.journal.approve' : 'accounting.journal.reject',
          actorId: user.id,
          entityType: 'JournalEntry',
          entityId: journal.code,
          metadata: { total: journal.total.toString() },
          ...meta,
        },
        tx,
      );
    });
    return { code: journal.code, status: approve ? 'APPROVED' : 'REJECTED' };
  }

  // ── accounting periods ──────────────────────────────────────────────

  /** The last 18 months, newest first, with whether each is closed. */
  async periods(today: IsoDate = kigaliDate()) {
    const rows = await this.prisma.accountingPeriod.findMany();
    const byMonth = new Map(rows.map((r) => [utcDateToIso(r.month), r]));
    const people = await this.names(
      rows.flatMap((r) => [r.closedById, r.reopenedById].filter((x): x is string => !!x)),
    );
    const pending = await this.prisma.journalEntry.groupBy({
      by: ['effectiveOn'],
      where: { status: 'PENDING' },
      _count: true,
    });
    const pendingByMonth = new Map<string, number>();
    for (const p of pending) {
      const m = monthStart(utcDateToIso(p.effectiveOn));
      pendingByMonth.set(m, (pendingByMonth.get(m) ?? 0) + p._count);
    }
    const out = [];
    for (let i = 0; i < 18; i++) {
      const month = monthStart(addMonths(monthStart(today), -i));
      const row = byMonth.get(month);
      out.push({
        month,
        closed: !!row?.closedAt,
        closedAt: row?.closedAt?.toISOString() ?? null,
        closedBy: row?.closedById ? (people.get(row.closedById) ?? null) : null,
        reopenedAt: row?.reopenedAt?.toISOString() ?? null,
        reopenedBy: row?.reopenedById ? (people.get(row.reopenedById) ?? null) : null,
        reopenReason: row?.reopenReason ?? null,
        pendingJournals: pendingByMonth.get(month) ?? 0,
        canClose: !row?.closedAt && monthEnd(month) < today,
      });
    }
    return out;
  }

  async closePeriod(month: IsoDate, user: AuthUser, meta: RequestMeta) {
    const start = monthStart(month);
    if (monthEnd(start) >= kigaliDate()) {
      throw new ConflictException('A month can be closed only after it has ended');
    }
    const earlierOpen = await this.prisma.accountingPeriod.count({
      where: { month: { lt: isoToUtcDate(start) }, closedAt: null },
    });
    if (earlierOpen > 0) throw new ConflictException('Close the earlier months first');
    const pending = await this.prisma.journalEntry.count({
      where: {
        status: 'PENDING',
        effectiveOn: { gte: isoToUtcDate(start), lte: isoToUtcDate(monthEnd(start)) },
      },
    });
    if (pending > 0) {
      throw new ConflictException(
        `Approve or reject the ${pending} journal${pending === 1 ? '' : 's'} waiting in this month first`,
      );
    }
    const tb = await this.trialBalance(monthEnd(start));
    if (!tb.balanced) throw new ConflictException('The trial balance does not balance');
    await this.prisma.accountingPeriod.upsert({
      where: { companyId_month: { companyId: requireCompanyId(), month: isoToUtcDate(start) } },
      update: { closedAt: new Date(), closedById: user.id },
      create: { month: isoToUtcDate(start), closedAt: new Date(), closedById: user.id },
    });
    await this.audit.record({
      action: 'accounting.period.close',
      actorId: user.id,
      entityType: 'AccountingPeriod',
      entityId: start.slice(0, 7),
      ...meta,
    });
    return this.periods();
  }

  async reopenPeriod(month: IsoDate, reason: string, user: AuthUser, meta: RequestMeta) {
    const start = monthStart(month);
    const row = await this.prisma.accountingPeriod.findFirst({
      where: { month: isoToUtcDate(start) },
    });
    if (!row?.closedAt) throw new ConflictException('This month is not closed');
    const laterClosed = await this.prisma.accountingPeriod.count({
      where: { month: { gt: isoToUtcDate(start) }, closedAt: { not: null } },
    });
    if (laterClosed > 0) throw new ConflictException('Reopen the later months first');
    await this.prisma.accountingPeriod.update({
      where: { id: row.id },
      data: {
        closedAt: null,
        reopenedAt: new Date(),
        reopenedById: user.id,
        reopenReason: reason.trim(),
      },
    });
    await this.audit.record({
      action: 'accounting.period.reopen',
      actorId: user.id,
      entityType: 'AccountingPeriod',
      entityId: start.slice(0, 7),
      metadata: { reason: reason.trim() },
      ...meta,
    });
    return this.periods();
  }

  // ── statements ──────────────────────────────────────────────────────

  async trialBalance(asOf: IsoDate = kigaliDate()) {
    return { asOf, ...trialBalance(await this.totals({ to: asOf })) };
  }

  async incomeStatement(from: IsoDate, to: IsoDate) {
    if (from > to) throw new BadRequestException('The start date is after the end date');
    return { from, to, ...incomeStatement(await this.totals({ from, to })) };
  }

  async balanceSheet(asOf: IsoDate = kigaliDate()) {
    return { asOf, ...balanceSheet(await this.totals({ to: asOf })) };
  }

  /** Every entry on one account in a date range, with the running balance. */
  async accountLedger(code: string, from: IsoDate, to: IsoDate) {
    const account = await this.prisma.ledgerAccount.findFirst({ where: { code } });
    if (!account) throw new NotFoundException(`No account ${code}`);
    const opening = await this.totals({ to: addDays(from, -1), code });
    const debitNormal = account.type === 'ASSET' || account.type === 'EXPENSE';
    const signed = (d: bigint, c: bigint) => (debitNormal ? d - c : c - d);
    let balance = opening[0] ? signed(opening[0].debits, opening[0].credits) : 0n;
    const openingBalance = balance;
    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        accountId: account.id,
        transaction: {
          effectiveOn: { gte: isoToUtcDate(from), lte: isoToUtcDate(to) },
        },
      },
      include: {
        transaction: { select: { type: true, memo: true, effectiveOn: true, postedAt: true } },
        loan: { select: { code: true } },
      },
      orderBy: [{ transaction: { effectiveOn: 'asc' } }, { createdAt: 'asc' }],
      take: 2000,
    });
    return {
      code: account.code,
      name: account.name,
      type: account.type,
      from,
      to,
      openingBalance,
      entries: entries.map((e) => {
        const debit = e.direction === 'DEBIT' ? e.amount : 0n;
        const credit = e.direction === 'CREDIT' ? e.amount : 0n;
        balance += signed(debit, credit);
        return {
          id: e.id,
          effectiveOn: utcDateToIso(e.transaction.effectiveOn),
          type: e.transaction.type,
          memo: e.transaction.memo,
          loanCode: e.loan?.code ?? null,
          debit,
          credit,
          balance,
        };
      }),
      closingBalance: balance,
    };
  }

  // ── helpers ─────────────────────────────────────────────────────────

  /**
   * Debit and credit totals per account for entries whose transaction is
   * effective in [from, to] (either end optional), over the whole chart.
   */
  private async totals(range: { from?: IsoDate; to?: IsoDate; code?: string }) {
    const from = range.from ? isoToUtcDate(range.from) : null;
    const to = range.to ? isoToUtcDate(range.to) : null;
    const code = range.code ?? null;
    const rows = await this.prisma.$queryRaw<
      Array<{ code: string; name: string; type: AccountType; debits: bigint; credits: bigint }>
    >`
      SELECT a."code", a."name", a."type"::text AS "type",
        COALESCE(SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" END), 0)::bigint AS debits,
        COALESCE(SUM(CASE WHEN e."direction" = 'CREDIT' THEN e."amount" END), 0)::bigint AS credits
      FROM "LedgerAccount" a
      LEFT JOIN "LedgerEntry" e ON e."accountId" = a."id"
        AND EXISTS (
          SELECT 1 FROM "LedgerTransaction" t
          WHERE t."id" = e."transactionId"
            AND (${from}::date IS NULL OR t."effectiveOn" >= ${from}::date)
            AND (${to}::date IS NULL OR t."effectiveOn" <= ${to}::date)
        )
      WHERE (${code}::text IS NULL OR a."code" = ${code}::text)
      GROUP BY a."code", a."name", a."type"
      ORDER BY a."code"`;
    return rows as AccountTotals[];
  }

  private async assertOpen(date: IsoDate) {
    const closed = await this.prisma.accountingPeriod.findFirst({
      where: { month: isoToUtcDate(monthStart(date)), closedAt: { not: null } },
    });
    if (closed) {
      throw new ConflictException(
        `The books for ${date.slice(0, 7)} are closed. Use a date in an open month.`,
      );
    }
  }

  private async assertPostable(codes: string[]) {
    const unique = [...new Set(codes)];
    const found = await this.prisma.ledgerAccount.findMany({ where: { code: { in: unique } } });
    for (const code of unique) {
      const a = found.find((f) => f.code === code);
      if (!a) throw new BadRequestException(`There is no account ${code}`);
      if (!a.isActive) throw new BadRequestException(`Account ${code} is switched off`);
      if (CONTROL_ACCOUNT_CODES.has(code)) {
        throw new BadRequestException(
          `Account ${code} (${a.name}) moves only through loan events, not manual journals`,
        );
      }
    }
  }

  private async names(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, ...userName.select },
    });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  }
}

const RANGE: Record<LedgerAccountType, string> = {
  ASSET: '1',
  LIABILITY: '2',
  EQUITY: '3',
  INCOME: '4',
  EXPENSE: '5',
};

function sameRange(code: string, type: LedgerAccountType): boolean {
  return /^\d{4}$/.test(code) && code.startsWith(RANGE[type]);
}
