import { Global, Module } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompanyMiddleware } from './company.middleware';

@Global()
@Module({
  providers: [CompaniesService, CompanyMiddleware],
  exports: [CompaniesService, CompanyMiddleware],
})
export class TenancyModule {}
