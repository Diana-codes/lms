import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { PiiCrypto } from './pii-crypto';

@Global()
@Module({
  providers: [
    {
      provide: PiiCrypto,
      inject: [ENV],
      useFactory: (env: Env) => new PiiCrypto(env.PII_ENCRYPTION_KEY, env.PII_HASH_KEY),
    },
  ],
  exports: [PiiCrypto],
})
export class PiiCryptoModule {}
