import { Injectable, Logger } from '@nestjs/common';
import { redactPii } from '@kora/core';
import type { ActorType, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEvent {
  action: string;
  actorId?: string | null;
  actorType?: ActorType;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/** Recursively scrub phone and ID numbers out of anything headed for the audit log. */
export function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactPii(value);
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactDeep(v)]),
    );
  }
  return value;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record who did what. Pass `tx` to write inside the same database
   * transaction as the change being audited, so neither exists without the other.
   */
  async record(event: AuditEvent, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.auditLog.create({
      data: {
        action: event.action,
        actorId: event.actorId ?? null,
        actorType: event.actorType ?? (event.actorId ? 'STAFF' : 'SYSTEM'),
        entityType: event.entityType,
        entityId: event.entityId,
        metadata: event.metadata
          ? (redactDeep(event.metadata) as Prisma.InputJsonValue)
          : undefined,
        ip: event.ip ?? null,
        userAgent: event.userAgent?.slice(0, 300) ?? null,
      },
    });
    this.logger.log(`${event.action} actor=${event.actorId ?? 'system'}`);
  }
}
