import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { DashboardService } from './dashboard.service';

@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('dashboard/overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.dashboard.overview(user);
  }

  @Get('notifications')
  notifications(@CurrentUser() user: AuthUser) {
    return this.dashboard.notifications(user);
  }

  @Post('notifications/read-all')
  @HttpCode(204)
  async readAll(@CurrentUser() user: AuthUser): Promise<void> {
    await this.dashboard.markNotificationsRead(user);
  }

  @Get('search')
  search(@Query('q', new ZodPipe(z.string().max(80).default(''))) q: string) {
    return this.dashboard.search(q);
  }
}
