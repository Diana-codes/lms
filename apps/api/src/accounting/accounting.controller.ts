import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { FINANCE_ROLES, formatRwf, kigaliDate, monthStart, OVERSIGHT_ROLES } from '@kora/core';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Audited } from '../audit/audited';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { isoDateString, requestMeta, rwfString } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { AccountingService } from './accounting.service';

const accountCode = z.string().regex(/^\d{4}$/, 'Account codes are four digits');
const dateQuery = new ZodPipe(isoDateString.optional());

const lineSchema = z
  .object({
    accountCode,
    direction: z.enum(['DEBIT', 'CREDIT']),
    amount: rwfString,
    note: z.string().trim().max(200).optional(),
  })
  .strict();

const journalSchema = z
  .object({
    effectiveOn: isoDateString,
    memo: z.string().trim().min(3).max(300),
    lines: z.array(lineSchema).min(2).max(40),
  })
  .strict();

const expenseSchema = z
  .object({
    expenseAccount: accountCode,
    paidFrom: z.enum(['BANK', 'MOMO_FLOAT', 'BRANCH_CASH', 'AIRTEL_FLOAT', 'ACCRUED_EXPENSES']),
    amount: rwfString,
    effectiveOn: isoDateString,
    memo: z.string().trim().min(3).max(300),
  })
  .strict();

const decideSchema = z
  .object({ approve: z.boolean(), reason: z.string().trim().max(300).optional() })
  .strict();

const accountSchema = z
  .object({
    code: accountCode,
    name: z.string().trim().min(2).max(80),
    type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
    description: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

const accountUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    isActive: z.boolean().optional(),
    description: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

const periodSchema = z.object({ month: isoDateString }).strict();
const reopenSchema = z
  .object({ month: isoDateString, reason: z.string().trim().min(5).max(300) })
  .strict();

/** PRD §10: the books. Accountants, managers and admins work here; auditors read. */
@Controller('accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Roles(...OVERSIGHT_ROLES)
  @Get('accounts')
  accounts(@Query('asOf', dateQuery) asOf?: string) {
    return this.accounting.accounts(asOf);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('accounts')
  addAccount(
    @Body(new ZodPipe(accountSchema)) body: z.infer<typeof accountSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.accounting.addAccount(body, user, requestMeta(req));
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Patch('accounts/:code')
  updateAccount(
    @Param('code', new ZodPipe(accountCode)) code: string,
    @Body(new ZodPipe(accountUpdateSchema)) body: z.infer<typeof accountUpdateSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.accounting.updateAccount(code, body, user, requestMeta(req));
  }

  @Roles(...OVERSIGHT_ROLES)
  @Get('accounts/:code/ledger')
  accountLedger(
    @Param('code', new ZodPipe(accountCode)) code: string,
    @Query('from', dateQuery) from?: string,
    @Query('to', dateQuery) to?: string,
  ) {
    const end = to ?? kigaliDate();
    return this.accounting.accountLedger(code, from ?? monthStart(end), end);
  }

  @Roles(...OVERSIGHT_ROLES)
  @Get('journals')
  journals(
    @Query('status', new ZodPipe(z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional()))
    status?: 'PENDING' | 'APPROVED' | 'REJECTED',
  ) {
    return this.accounting.journals(status);
  }

  @Roles(...FINANCE_ROLES)
  @Post('journals')
  createJournal(
    @Body(new ZodPipe(journalSchema)) body: z.infer<typeof journalSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.accounting.createJournal({ ...body, kind: 'GENERAL' }, user, requestMeta(req));
  }

  @Roles(...FINANCE_ROLES)
  @Post('expenses')
  recordExpense(
    @Body(new ZodPipe(expenseSchema)) body: z.infer<typeof expenseSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.accounting.recordExpense(body, user, requestMeta(req));
  }

  @Roles(...FINANCE_ROLES)
  @Post('journals/:code/decide')
  @HttpCode(200)
  decideJournal(
    @Param('code', new ZodPipe(z.string().regex(/^JV-\d{5,}$/))) code: string,
    @Body(new ZodPipe(decideSchema)) body: z.infer<typeof decideSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.accounting.decideJournal(code, body.approve, body.reason, user, requestMeta(req));
  }

  @Roles(...OVERSIGHT_ROLES)
  @Get('periods')
  periods() {
    return this.accounting.periods();
  }

  @Roles('ADMIN', 'ACCOUNTANT', 'MANAGER')
  @Post('periods/close')
  @HttpCode(200)
  closePeriod(
    @Body(new ZodPipe(periodSchema)) body: z.infer<typeof periodSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.accounting.closePeriod(body.month, user, requestMeta(req));
  }

  /** Reopening changes closed books: administrators only, with a reason. */
  @Roles('ADMIN')
  @Post('periods/reopen')
  @HttpCode(200)
  reopenPeriod(
    @Body(new ZodPipe(reopenSchema)) body: z.infer<typeof reopenSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.accounting.reopenPeriod(body.month, body.reason, user, requestMeta(req));
  }

  @Roles(...OVERSIGHT_ROLES)
  @Get('trial-balance')
  trialBalance(@Query('asOf', dateQuery) asOf?: string) {
    return this.accounting.trialBalance(asOf);
  }

  @Roles(...OVERSIGHT_ROLES)
  @Get('income-statement')
  incomeStatement(@Query('from', dateQuery) from?: string, @Query('to', dateQuery) to?: string) {
    const end = to ?? kigaliDate();
    return this.accounting.incomeStatement(from ?? `${end.slice(0, 4)}-01-01`, end);
  }

  @Roles(...OVERSIGHT_ROLES)
  @Get('balance-sheet')
  balanceSheet(@Query('asOf', dateQuery) asOf?: string) {
    return this.accounting.balanceSheet(asOf);
  }

  /** Statements as CSV, for Excel (PRD §10.4: authorised export). */
  @Roles(...OVERSIGHT_ROLES)
  @Audited({ action: 'accounting.export', entityType: 'Statement' })
  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(
    @Query('statement', new ZodPipe(z.enum(['trial-balance', 'income-statement', 'balance-sheet'])))
    statement: 'trial-balance' | 'income-statement' | 'balance-sheet',
    @Query('from', dateQuery) from: string | undefined,
    @Query('to', dateQuery) to: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const end = to ?? kigaliDate();
    const amount = (v: bigint) =>
      formatRwf(v, { symbol: false }).replace(/,/g, '').replace('−', '-');
    const rows: string[][] = [];
    if (statement === 'trial-balance') {
      const tb = await this.accounting.trialBalance(end);
      rows.push([`Trial balance as of ${end}`], ['Code', 'Account', 'Debit', 'Credit']);
      for (const r of tb.rows) rows.push([r.code, r.name, amount(r.debit), amount(r.credit)]);
      rows.push(['', 'Total', amount(tb.totalDebit), amount(tb.totalCredit)]);
    } else if (statement === 'income-statement') {
      const start = from ?? `${end.slice(0, 4)}-01-01`;
      const is = await this.accounting.incomeStatement(start, end);
      rows.push([`Income statement ${start} to ${end}`], ['Code', 'Account', 'Amount']);
      for (const l of is.income) rows.push([l.code, l.name, amount(l.amount)]);
      rows.push(['', 'Total income', amount(is.totalIncome)]);
      for (const l of is.expenses) rows.push([l.code, l.name, amount(l.amount)]);
      rows.push(['', 'Total expenses', amount(is.totalExpenses)]);
      rows.push(['', 'Net profit', amount(is.netProfit)]);
    } else {
      const bs = await this.accounting.balanceSheet(end);
      rows.push([`Balance sheet as of ${end}`], ['Code', 'Account', 'Amount']);
      for (const l of bs.assets) rows.push([l.code, l.name, amount(l.amount)]);
      rows.push(['', 'Total assets', amount(bs.totalAssets)]);
      for (const l of bs.liabilities) rows.push([l.code, l.name, amount(l.amount)]);
      rows.push(['', 'Total liabilities', amount(bs.totalLiabilities)]);
      for (const l of bs.equity) rows.push([l.code, l.name, amount(l.amount)]);
      rows.push(['', 'Current earnings', amount(bs.currentEarnings)]);
      rows.push(['', 'Total equity', amount(bs.totalEquity)]);
    }
    res.setHeader('Content-Disposition', `attachment; filename="${statement}-${end}.csv"`);
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
}

function csvCell(value: string): string {
  // Neutralise spreadsheet formulas and quote anything with separators.
  const safe = /^[=+\-@]/.test(value) && !/^-\d/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
