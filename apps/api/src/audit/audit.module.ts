import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditLogController } from './audit-log.controller';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audited';

@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}
