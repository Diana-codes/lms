import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { type Period, ReportsService } from './reports.service';

const periodQuery = new ZodPipe(z.enum(['Q', 'YTD', '12M']).default('12M'));
const asOfQuery = new ZodPipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional());

/** Portfolio-wide figures: managers and administrators. */
@Roles('MANAGER', 'ADMIN')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  report(@Query('period', periodQuery) period: Period) {
    return this.reports.report(period);
  }

  /** BNR Regulation 59/2023 Art. 34 — credit classification and provisions. */
  @Get('classification')
  classification(@Query('asOf', asOfQuery) asOf: string | undefined) {
    return this.reports.classification(asOf);
  }

  @Get('classification.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async classificationCsv(
    @Query('asOf', asOfQuery) asOf: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const r = await this.reports.classification(asOf);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="kora-lend-classification-${r.asOf}.csv"`,
    );
    const esc = (v: string | number | bigint) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const pct = (bps: number) => (bps / 100).toFixed(2);
    const lines = [
      `BNR 59/2023 credit classification,${esc(r.company)},as of ${r.asOf},profile ${r.profile}`,
      '',
      'Class,Loans,Outstanding principal (RWF),Required provision (RWF),Provision rate (%),Non-performing',
      ...r.buckets.map((b) =>
        [
          b.label,
          b.loanCount,
          b.outstandingPrincipal,
          b.requiredProvision,
          pct(b.provisionBps),
          b.nonPerforming ? 'yes' : 'no',
        ]
          .map(esc)
          .join(','),
      ),
      '',
      `Total loans,${r.loans}`,
      `Outstanding principal,${r.outstandingPrincipal}`,
      `Required provision,${r.requiredProvision}`,
      `Allowance held,${r.allowanceHeld}`,
      `NPL ratio (%),${pct(r.nplBps)}`,
    ];
    return `${lines.join('\r\n')}\r\n`;
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async csv(
    @Query('period', periodQuery) period: Period,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Content-Disposition', `attachment; filename="kora-lend-report-${period}.csv"`);
    return this.reports.csv(period);
  }
}
