import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { Roles } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { type Period, ReportsService } from './reports.service';

const periodQuery = new ZodPipe(z.enum(['Q', 'YTD', '12M']).default('12M'));

/** Portfolio-wide figures: managers and administrators. */
@Roles('MANAGER', 'ADMIN')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  report(@Query('period', periodQuery) period: Period) {
    return this.reports.report(period);
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
