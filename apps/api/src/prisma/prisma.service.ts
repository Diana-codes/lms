import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { ENV, type Env } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';
import { currentCompanyId } from '../tenancy/company-context';
import { TenantPool } from '../tenancy/tenant-pool';

/**
 * The database client for company data. It connects with a login that owns
 * nothing (APP_DATABASE_URL), so row-level security limits every query to the
 * company of the current request or job.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({
      adapter: new PrismaPg(
        new TenantPool({ connectionString: env.APP_DATABASE_URL }, currentCompanyId),
      ),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/**
 * The owner login (DATABASE_URL), which bypasses row-level security. Only for
 * platform administration: creating companies, platform admin sign-in, usage
 * across companies. Never use it to serve a company's own requests.
 */
@Injectable()
export class PlatformPrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENV) env: Env) {
    super({
      adapter: new PrismaPg(
        new TenantPool({ connectionString: env.DATABASE_URL, max: 5 }, currentCompanyId),
      ),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
