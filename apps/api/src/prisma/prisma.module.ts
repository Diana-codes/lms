import { Global, Module } from '@nestjs/common';
import { PlatformPrismaService, PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, PlatformPrismaService],
  exports: [PrismaService, PlatformPrismaService],
})
export class PrismaModule {}
