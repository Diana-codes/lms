import { Global, Logger, Module } from '@nestjs/common';
import { PiiCrypto } from '../common/pii-crypto';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { MomoGateway } from './momo.gateway';
import { MtnMomoGateway } from './momo.mtn';
import { MomoSimulator } from './momo.simulator';
import { AfricasTalkingGateway, SmsGateway, SmsSimulator } from './sms.gateway';

const logger = new Logger('Providers');

/**
 * Picks the real provider when its keys are present, and the local simulator
 * otherwise. Production refuses to start on a simulator.
 */
@Global()
@Module({
  providers: [
    {
      provide: MomoGateway,
      inject: [ENV, PrismaService, PiiCrypto],
      useFactory: (env: Env, prisma: PrismaService, crypto: PiiCrypto): MomoGateway => {
        if (env.MOMO_COLLECTION_SUBSCRIPTION_KEY && env.MOMO_DISBURSEMENT_SUBSCRIPTION_KEY) {
          logger.log(`MoMo: MTN (${env.MOMO_TARGET_ENVIRONMENT})`);
          return new MtnMomoGateway(env, prisma, crypto);
        }
        if (env.NODE_ENV === 'production')
          throw new Error('MoMo subscription keys are required in production');
        logger.warn('MoMo: local simulator (no subscription keys set)');
        return new MomoSimulator(prisma);
      },
    },
    {
      provide: SmsGateway,
      inject: [ENV],
      useFactory: (env: Env): SmsGateway => {
        if (env.AFRICASTALKING_API_KEY) {
          logger.log(`SMS: Africa's Talking (${env.AFRICASTALKING_USERNAME})`);
          return new AfricasTalkingGateway(env);
        }
        if (env.NODE_ENV === 'production')
          throw new Error("An Africa's Talking API key is required in production");
        logger.warn('SMS: local simulator (no API key set)');
        return new SmsSimulator();
      },
    },
  ],
  exports: [MomoGateway, SmsGateway],
})
export class ProvidersModule {}
