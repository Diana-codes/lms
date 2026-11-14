import { Global, Module } from '@nestjs/common';
import { CompanySecretsService } from '../tenancy/company-secrets.service';
import { ProvidersService } from './providers.service';

/** Per-company MoMo and SMS providers. See ProvidersService. */
@Global()
@Module({
  providers: [CompanySecretsService, ProvidersService],
  exports: [CompanySecretsService, ProvidersService],
})
export class ProvidersModule {}
