import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  daysPastDue,
  dpdBucket,
  isoToUtcDate,
  kigaliDate,
  kigaliDayStart,
  utcDateToIso,
} from '@kora/core';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { ENV, type Env } from '../config/env';
import { ScoringService } from '../ai/scoring.service';
import { MoneyService } from '../money/money.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { CompaniesService, type CompanyInfo } from '../tenancy/companies.service';
import { requireCompanyId } from '../tenancy/company-context';

const QUEUE = 'kora-jobs';
type JobName = 'poll-momo' | 'nightly-tick';
/** Each company's nightly run starts at this hour in its own time zone. */
const NIGHTLY_HOUR = 1;

/** The hour of day (0–23) in a time zone. */
export function localHour(timezone: string, at: Date = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  return Number(hour);
}

/**
 * Background work on BullMQ + Redis, done company by company (each in its
 * own company context, so row-level security applies as for a request):
 *  - every minute, follow up MoMo requests still waiting on the provider;
 *  - every night at 01:00 in the company's time zone, recompute days past
 *    due, open and close collection cases, mark broken promises, send
 *    due-soon reminders, and record the day's usage for billing.
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
    private readonly companies: CompaniesService,
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
    await this.queue.removeJobScheduler('nightly').catch(() => undefined);
    await this.queue.upsertJobScheduler('poll-momo', { every: 60_000 }, { name: 'poll-momo' });
    await this.queue.upsertJobScheduler(
      'nightly-tick',
      { pattern: '0 * * * *' },
      { name: 'nightly-tick' },
    );
    this.logger.log('Background jobs scheduled');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  async run(name: JobName): Promise<unknown> {
    if (name === 'poll-momo')
      return this.forEachCompany('poll-momo', () => this.money.pollPending());
    const now = new Date();
    return this.forEachCompany(
      'nightly',
      () => this.nightly(),
      (company) => localHour(company.timezone, now) === NIGHTLY_HOUR,
    );
  }

  /**
   * Run a job for every active company, each in its own context. One
   * company's failure is logged and does not stop the others.
   */
  private async forEachCompany(
    label: string,
    work: () => Promise<unknown>,
    due: (company: CompanyInfo) => boolean = () => true,
  ): Promise<{ ran: number; failed: number }> {
    let ran = 0;
    let failed = 0;
    for (const company of await this.companies.active()) {
      if (!due(company)) continue;
      try {
        await this.companies.runAs(company, work);
        ran += 1;
      } catch (err) {
        failed += 1;
        this.logger.error(`${label} failed for ${company.slug}: ${(err as Error).message}`);
      }
    }
    return { ran, failed };
  }

  /** Follow up the current company's pending MoMo requests. */
  pollMomo() {
    return this.money.pollPending();
  }

  /** The end-of-day run for the current company. Safe to run more than once a day. */
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

    const usage = await this.recordUsage(today, loans.length);

    const summary = {
      asOf: today,
      loans: loans.length,
      buckets,
      casesOpened: opened,
      casesClosed: closed,
      promisesBroken: broken.count,
      reminders,
      earlyWarnings: warnings?.flagged.length ?? null,
      usage,
    };
    await this.audit.record({ action: 'system.nightly', actorType: 'SYSTEM', metadata: summary });
    this.logger.log(
      `Nightly run: ${opened} cases opened, ${closed} closed, ${reminders.sent} reminders`,
    );
    return summary;
  }

  /** The day's usage figures for billing. Recorded once per day; a re-run updates them. */
  private async recordUsage(today: string, activeLoans: number) {
    const dayStart = kigaliDayStart(today);
    const [borrowers, activeStaff, loansDisbursed, smsSent] = await Promise.all([
      this.prisma.borrower.count(),
      this.prisma.user.count({ where: { isActive: true } }),
      this.prisma.disbursement.count({
        where: { status: 'SUCCESSFUL', confirmedAt: { gte: dayStart } },
      }),
      this.prisma.smsMessage.count({
        where: { createdAt: { gte: dayStart }, status: { not: 'FAILED' } },
      }),
    ]);
    const figures = { activeLoans, borrowers, activeStaff, loansDisbursed, smsSent };
    const day = isoToUtcDate(today);
    await this.prisma.companyUsageDaily.upsert({
      where: { companyId_day: { companyId: requireCompanyId(), day } },
      update: { ...figures, recordedAt: new Date() },
      create: { day, ...figures },
    });
    return figures;
  }
}
