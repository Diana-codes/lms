import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ENV, type Env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, RolesGuard } from './guards';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: Buffer.from(env.JWT_ACCESS_SECRET, 'base64'),
        signOptions: { algorithm: 'HS256', issuer: 'kora-lend' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'kora-lend' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // Order matters: authenticate first, then check the role.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
