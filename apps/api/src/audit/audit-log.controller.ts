import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { Roles } from '../auth/decorators';
import { isoDateString, pageQuery } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { addDays, kigaliDayStart } from '@kora/core';

const querySchema = z
  .object({
    action: z.string().trim().max(80).optional(),
    entityType: z.string().trim().max(40).optional(),
    entityId: z.string().trim().max(80).optional(),
    actorId: z.uuid().optional(),
    from: isoDateString.optional(),
    to: isoDateString.optional(),
    page: pageQuery,
  })
  .strict();

const PAGE_SIZE = 50;

/**
 * PRD §14.5 / US-13: who did what and when. Read-only by construction: the
 * audit log is append-only in the database (trigger), and this is GET only.
 */
@Roles('ADMIN', 'MANAGER', 'AUDITOR')
@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query(new ZodPipe(querySchema)) q: z.infer<typeof querySchema>) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (q.from) createdAt.gte = kigaliDayStart(q.from);
    if (q.to) createdAt.lt = kigaliDayStart(addDays(q.to, 1));
    const where: Prisma.AuditLogWhereInput = {
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.from || q.to ? { createdAt } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => !!x))];
    const users = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, firstName: true, lastName: true, role: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u]));
    return {
      total,
      page: q.page,
      pageSize: PAGE_SIZE,
      items: rows.map((r) => {
        const u = r.actorId ? names.get(r.actorId) : undefined;
        return {
          id: r.id,
          at: r.createdAt.toISOString(),
          action: r.action,
          actorType: r.actorType,
          actor: u ? `${u.firstName} ${u.lastName}` : r.actorType === 'SYSTEM' ? 'System' : null,
          actorRole: u?.role ?? null,
          entityType: r.entityType,
          entityId: r.entityId,
          // Metadata is masked when written (redactPii); safe to show.
          metadata: r.metadata,
          ip: r.ip,
        };
      }),
    };
  }
}
