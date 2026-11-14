import { Module } from '@nestjs/common';
import { AiClient } from './ai/ai.client';
import { AiController } from './ai/ai.controller';
import { AiService } from './ai/ai.service';
import { ScoringService } from './ai/scoring.service';
import { ApplicationsController } from './applications/applications.controller';
import { ApplicationsService } from './applications/applications.service';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BorrowersController } from './borrowers/borrowers.controller';
import { BorrowersService } from './borrowers/borrowers.service';
import { OffersController } from './borrowers/offers.controller';
import { BorrowerAppController } from './borrower-app/borrower-app.controller';
import { BorrowerAppService } from './borrower-app/borrower-app.service';
import { BorrowerAuthService } from './borrower-app/borrower-auth.service';
import { BorrowerGuard } from './borrower-app/borrower.guard';
import { UploadsService } from './borrower-app/uploads.service';
import { CollectionsController } from './collections/collections.controller';
import { CollectionsService } from './collections/collections.service';
import { PiiCryptoModule } from './common/pii-crypto.module';
import { ConfigModule } from './config/config.module';
import { DashboardController } from './dashboard/dashboard.controller';
import { DashboardService } from './dashboard/dashboard.service';
import { HealthController } from './health/health.controller';
import { JobsController } from './jobs/jobs.controller';
import { JobsService } from './jobs/jobs.service';
import { LedgerModule } from './ledger/ledger.module';
import { LoansController } from './loans/loans.controller';
import { LoansService } from './loans/loans.service';
import { PaymentPoster } from './loans/payment-poster';
import { MoneyController } from './money/money.controller';
import { MoneyService } from './money/money.service';
import { ProvidersModule } from './providers/providers.module';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { SmsController } from './sms/sms.controller';
import { SmsService } from './sms/sms.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { PrismaModule } from './prisma/prisma.module';
import { SystemController } from './system/system.controller';
import { PlatformModule } from './platform/platform.module';
import { CompanySettingsService } from './tenancy/company-settings.service';
import { CompanyController } from './tenancy/company.controller';
import { TenancyModule } from './tenancy/tenancy.module';
import { StaffService } from './users/staff.service';
import { UsersController } from './users/users.controller';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    TenancyModule,
    PiiCryptoModule,
    AuditModule,
    AuthModule,
    LedgerModule,
    ProvidersModule,
    PlatformModule,
  ],
  controllers: [
    HealthController,
    CompanyController,
    UsersController,
    SystemController,
    ProductsController,
    ApplicationsController,
    LoansController,
    BorrowersController,
    DashboardController,
    MoneyController,
    SmsController,
    CollectionsController,
    JobsController,
    OffersController,
    BorrowerAppController,
    ReportsController,
    AiController,
  ],
  providers: [
    ApplicationsService,
    LoansService,
    PaymentPoster,
    BorrowersService,
    DashboardService,
    MoneyService,
    SmsService,
    CollectionsService,
    JobsService,
    BorrowerAuthService,
    BorrowerAppService,
    BorrowerGuard,
    UploadsService,
    ReportsService,
    AiClient,
    AiService,
    ScoringService,
    StaffService,
    CompanySettingsService,
    ProductsService,
  ],
})
export class AppModule {}
