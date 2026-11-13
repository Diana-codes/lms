import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { daysPastDue, dpdBucket, isoToUtcDate, kigaliDate, utcDateToIso } from '@kora/core';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { ENV, type Env } from '../config/env';
import { ScoringService } from '../ai/scoring.service';
import { MoneyService } from '../money/money.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';

const QUEUE = 'kora-jobs';
type JobName = 'poll-momo' | 'nightly';

/**
 * Background work on BullMQ + Redis:
 *  - every minute, follow up MoMo requests still waiting on the provider;
 *  - every night at 01:00 Kigali, recompute days past due, open and close
 *    collection cases, mark broken promises, and send due-soon reminders.
 * The nightly run can also be started by hand from the API, for demos.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private connection: IORedis | null = null;
  private queue: Queue | null = null;
  private worker: Worker | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly prisma: PrismaService,
    private readonly money: MoneyService,
    private readonly sms: SmsService,
    private readonly audit: AuditService,
    private readonly scoring: ScoringService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.env.JOBS_ENABLED || this.env.NODE_ENV === 'test') return;
    try {
      this.connection = new IORedis(this.env.REDIS_URL, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });
      await this.connection.connect();
    } catch (err) {
      this.logger.warn(
        `Redis is not reachable (${(err as Error).message}). Background jobs are off.`,
      );
      this.connection = null;
      return;
    }
    this.queue = new Queue(QUEUE, { connection: this.connection });
    this.worker = new Worker(QUEUE, (job) => this.run(job.name as JobName), {
      connection: this.connection,
      concurrency: 1,
    });
    this.worker.on('failed', (job, err) =>
      this.logger.error(`${job?.name} failed: ${err.message}`),
    );
    await this.queue.upsertJobScheduler('poll-momo', { every: 60_000 }, { name: 'poll-momo' });
    await this.queue.upsertJobScheduler(
      'nightly',
      { pattern: '0 1 * * *', tz: 'Africa/Kigali' },
      { name: 'nightly' },
    );
    this.logger.log('Background jobs scheduled');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  async run(name: JobName): Promise<unknown> {
    if (name === 'poll-momo') return this.money.pollPending();
    return this.nightly();
  }

  /** The end-of-day run. Safe to run more than once a day. */
  async nightly() {
    const today = kigaliDate();
    const loans = await this.prisma.loan.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        code: true,
        officerId: true,
        principal: true,
        instalments: {
          where: { supersededAt: null, status: { not: 'PAID' } },
          orderBy: { dueDate: 'asc' },
          take: 1,
          select: { dueDate: true },
        },
        collectionCases: { where: { closedAt: null }, select: { id: true, dpdAtOpen: true } },
      },
    });

    let opened = 0;
    let closed = 0;
    let crossed31 = 0;
    const buckets = { CURRENT: 0, DPD_1_30: 0, DPD_31_90: 0, DPD_90_PLUS: 0 };
    for (const loan of loans) {
      const dpd = daysPastDue(
        loan.instalments[0] ? utcDateToIso(loan.instalments[0].dueDate) : null,
        today,
      );
      const bucket = dpdBucket(dpd);
      buckets[bucket] += 1;
      const open = loan.collectionCases[0];
      if (dpd > 0 && !open) {
        await this.prisma.collectionCase.create({
          data: {
            loanId: loan.id,
            dpdAtOpen: dpd,
            nextAction: dpd > 7 ? 'CALL' : 'SMS',
            assignedToId: loan.officerId,
          },
        });
        opened += 1;
      } else if (dpd === 0 && open) {
        await this.prisma.collectionCase.update({
          where: { id: open.id },
          data: { status: 'RESOLVED', closedAt: new Date() },
        });
        closed += 1;
      }
      if (dpd === 31) crossed31 += 1;
    }

    // Promises whose date has passed without a payment are broken.
    const broken = await this.prisma.promiseToPay.updateMany({
      where: { status: 'OPEN', promisedFor: { lt: isoToUtcDate(today) } },
      data: { status: 'BROKEN' },
    });

    const reminders = await this.sms.sendDueReminders({ days: 3 });
    const warnings = await this.scoring.earlyWarning().catch(() => null);

    if (crossed31 > 0) {
      const managers = await this.prisma.user.findMany({
        where: { role: { in: ['MANAGER', 'ADMIN', 'COLLECTIONS_AGENT'] }, isActive: true },
        select: { id: true },
      });
      await this.prisma.notification.createMany({
        data: managers.map((m) => ({
          userId: m.id,
          kind: 'RISK' as const,
          title: `${crossed31} ${crossed31 === 1 ? 'loan' : 'loans'} moved into 31–90 days late`,
          href: '/collections?bucket=DPD_31_90',
        })),
      });
    }

    const summary = {
      asOf: today,
      loans: loans.length,
      buckets,
      casesOpened: opened,
      casesClosed: closed,
      promisesBroken: broken.count,
      reminders,
      earlyWarnings: warnings?.flagged.length ?? null,
    };
    await this.audit.record({ action: 'system.nightly', actorType: 'SYSTEM', metadata: summary });
    this.logger.log(
      `Nightly run: ${opened} cases opened, ${closed} closed, ${reminders.sent} reminders`,
    );
    return summary;
  }
}
