import { Module } from '@nestjs/common';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformController } from './platform.controller';
import { PlatformGuard } from './platform.guard';
import { PlatformService } from './platform.service';

/** Platform administration: see PlatformController. */
@Module({
  controllers: [PlatformController],
  providers: [PlatformAuthService, PlatformService, PlatformGuard],
})
export class PlatformModule {}
