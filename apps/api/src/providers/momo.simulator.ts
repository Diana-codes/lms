import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MomoGateway, type MomoRequest, type MomoResult } from './momo.gateway';

/**
 * Stands in for MTN MoMo when no keys are configured, so the whole flow can
 * be built, demonstrated and tested offline. It behaves like the real thing:
 * a request is accepted, stays pending for a moment, then settles.
 *
 * The outcome depends on the phone number, so every path can be exercised:
 *   ends in 00 → fails ("payer declined")
 *   ends in 99 → stays pending (never answers)
 *   otherwise  → succeeds
 */
@Injectable()
export class MomoSimulator extends MomoGateway {
  readonly name = 'simulator' as const;
  /** How long a request stays pending. Tests set this to zero. */
  static settleAfterMs = 2500;

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  requestToPay(request: MomoRequest): Promise<void> {
    return this.accept('collection', request);
  }

  transfer(request: MomoRequest): Promise<void> {
    return this.accept('disbursement', request);
  }

  requestToPayStatus(referenceId: string): Promise<MomoResult> {
    return this.status(referenceId);
  }

  transferStatus(referenceId: string): Promise<MomoResult> {
    return this.status(referenceId);
  }

  private async accept(kind: string, request: MomoRequest): Promise<void> {
    await this.prisma.simulatedTransfer.create({
      data: { reference: request.referenceId, kind, phone: request.phone, amount: request.amount },
    });
  }

  private async status(referenceId: string): Promise<MomoResult> {
    const row = await this.prisma.simulatedTransfer.findUnique({
      where: { reference: referenceId },
    });
    if (!row) return { status: 'FAILED', reason: 'Unknown reference' };
    if (row.phone.endsWith('99')) return { status: 'PENDING' };
    if (Date.now() - row.createdAt.getTime() < MomoSimulator.settleAfterMs)
      return { status: 'PENDING' };
    if (row.phone.endsWith('00'))
      return { status: 'FAILED', reason: 'The payer declined the request' };
    return {
      status: 'SUCCESSFUL',
      financialTransactionId: `SIM${referenceId.replace(/-/g, '').slice(0, 12).toUpperCase()}`,
    };
  }
}
