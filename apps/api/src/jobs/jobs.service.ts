import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import {
  classifyLoan,
  classifyPortfolio,
  type CreditClassProfile,
  daysPastDue,
  dpdBucket,
  interestAccrualSuspended,
  isoToUtcDate,
  type IsoDate,
  kigaliDate,
  kigaliDayStart,
  penaltyToCharge,
  utcDateToIso,
} from '@kora/core';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { AuditService } from '../audit/audit.service';
import { ENV, type Env } from '../config/env';
import { ScoringService } from '../ai/scoring.service';
import { interestAccrualLines, provisionAdjustmentLines } from '../ledger/posting';
import { LedgerService } from '../ledger/ledger.service';
import { LoanSecurityService } from '../loans/loan-security.service';
import { MoneyService } from '../money/money.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loanTerms, toLedger } from '../products/terms';
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
 *  - every night at 01:00 in the company's time zone, accrue interest that
 *    has fallen due (unless the loan is 91+ days late), charge late fees,
 *    classify and provision under BNR 59/2023, recompute days past due, open
 *    and close collection cases, mark broken promises, send due-soon
 *    reminders, and record the day's usage for billing.
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
    private readonly ledger: LedgerService,
    private readonly security: LoanSecurityService,
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

  /**
   * Late charges under each loan's own terms, counted up to today. Each loan
   * is locked while it is charged, as payments lock it too. Running twice in
   * a day charges nothing the second time.
   */
  async chargeLateFees(today: IsoDate = kigaliDate()) {
    const candidates = await this.prisma.loan.findMany({
      where: {
        status: 'ACTIVE',
        terms: { not: Prisma.DbNull },
        instalments: {
          some: {
            supersededAt: null,
            status: { not: 'PAID' },
            dueDate: { lt: isoToUtcDate(today) },
          },
        },
      },
      select: { id: true },
    });
    let instalments = 0;
    let total = 0n;
    for (const { id } of candidates) {
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Loan" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const loan = await tx.loan.findUniqueOrThrow({
          where: { id },
          include: {
            instalments: {
              where: { supersededAt: null },
              orderBy: [{ scheduleVersion: 'asc' }, { number: 'asc' }],
            },
          },
        });
        const terms = loanTerms(loan);
        if (terms.penalty.method === 'NONE') return;
        const ledgerRows = toLedger(loan.instalments, loan.disbursedOn);
        let chargedOnLoan = loan.instalments.reduce((s, i) => s + i.penaltyDue, 0n);
        for (const [i, row] of loan.instalments.entries()) {
          if (row.status === 'PAID') continue;
          const countedTo = row.penaltyThrough ? utcDateToIso(row.penaltyThrough) : null;
          const { charge, accruedThrough } = penaltyToCharge({
            instalment: ledgerRows[i]!,
            terms,
            asOf: today,
            accruedThrough: countedTo,
            chargedOnLoan,
            loanPrincipal: loan.principal,
          });
          if (charge === 0n && accruedThrough === countedTo) continue;
          await tx.scheduleInstalment.update({
            where: { id: row.id },
            data: {
              penaltyDue: { increment: charge },
              penaltyThrough: accruedThrough ? isoToUtcDate(accruedThrough) : null,
            },
          });
          if (charge > 0n) {
            chargedOnLoan += charge;
            instalments += 1;
            total += charge;
          }
        }
      });
    }
    return { instalments, total };
  }

  /**
   * Recognise interest that has fallen due: DR interest receivable /
   * CR interest income. Skips loans at 91+ DPD. Safe to run more than once
   * a day — already-accrued amounts are not posted again.
   */
  async accrueInterest(today: IsoDate = kigaliDate()) {
    const candidates = await this.prisma.loan.findMany({
      where: {
        status: 'ACTIVE',
        instalments: {
          some: {
            supersededAt: null,
            status: { not: 'PAID' },
            dueDate: { lte: isoToUtcDate(today) },
          },
        },
      },
      select: {
        id: true,
        interestSuspendedAt: true,
        instalments: {
          where: { supersededAt: null, status: { not: 'PAID' } },
          orderBy: { dueDate: 'asc' },
          select: {
            id: true,
            number: true,
            scheduleVersion: true,
            dueDate: true,
            interestDue: true,
            interestAccrued: true,
            status: true,
          },
        },
      },
    });

    let instalments = 0;
    let total = 0n;
    let suspended = 0;
    let resumed = 0;

    for (const loan of candidates) {
      const oldestUnpaid = loan.instalments[0] ?? null;
      const dpd = daysPastDue(
        oldestUnpaid ? utcDateToIso(oldestUnpaid.dueDate) : null,
        today,
      );
      const stop = interestAccrualSuspended(dpd);

      if (stop && !loan.interestSuspendedAt) {
        await this.prisma.loan.update({
          where: { id: loan.id },
          data: { interestSuspendedAt: new Date() },
        });
        suspended += 1;
      } else if (!stop && loan.interestSuspendedAt) {
        await this.prisma.loan.update({
          where: { id: loan.id },
          data: { interestSuspendedAt: null },
        });
        resumed += 1;
      }

      if (stop) continue;

      const due = loan.instalments.filter(
        (row) =>
          daysPastDue(utcDateToIso(row.dueDate), today) >= 0 &&
          row.interestDue > row.interestAccrued,
      );
      if (due.length === 0) continue;

      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Loan" WHERE "id" = ${loan.id}::uuid FOR UPDATE`;
        const locked = await tx.loan.findUniqueOrThrow({
          where: { id: loan.id },
          include: {
            instalments: {
              where: { supersededAt: null, status: { not: 'PAID' } },
              orderBy: { dueDate: 'asc' },
            },
          },
        });
        const lockedOldest = locked.instalments[0] ?? null;
        const lockedDpd = daysPastDue(
          lockedOldest ? utcDateToIso(lockedOldest.dueDate) : null,
          today,
        );
        if (interestAccrualSuspended(lockedDpd)) return;

        for (const row of locked.instalments) {
          if (daysPastDue(utcDateToIso(row.dueDate), today) < 0) continue;
          const amount = row.interestDue - row.interestAccrued;
          if (amount <= 0n) continue;
          await this.ledger.post(tx, {
            type: 'INTEREST_ACCRUAL',
            idempotencyKey: `interest-accrual:${row.id}:${row.interestAccrued}`,
            loanId: loan.id,
            effectiveOn: utcDateToIso(row.dueDate),
            memo: `Interest due on instalment ${row.number}`,
            lines: interestAccrualLines(amount),
          });
          await tx.scheduleInstalment.update({
            where: { id: row.id },
            data: { interestAccrued: row.interestDue },
          });
          instalments += 1;
          total += amount;
        }
      });
    }

    return { instalments, total, suspended, resumed };
  }

  /**
   * BNR Regulation 59/2023: classify every active loan by DPD, store the
   * day's portfolio snapshot, and move the loan-loss allowance to the
   * required general/specific provision. Safe to run more than once a day.
   */
  async classifyAndProvision(today: IsoDate = kigaliDate()) {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: requireCompanyId() },
      select: { creditClassProfile: true },
    });
    const profile = company.creditClassProfile as CreditClassProfile;

    const loans = await this.prisma.loan.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        instalments: {
          where: { supersededAt: null, status: { not: 'PAID' } },
          orderBy: { dueDate: 'asc' },
          take: 1,
          select: { dueDate: true },
        },
      },
    });

    const classified: Array<{
      id: string;
      outstandingPrincipal: bigint;
      dpd: number;
      admissibleCollateral: bigint;
      creditClass: ReturnType<typeof classifyLoan>['creditClass'];
      requiredProvision: bigint;
    }> = [];

    for (const loan of loans) {
      const outstanding = await this.ledger.outstandingPrincipal(loan.id);
      if (outstanding <= 0n) continue;
      const dpd = daysPastDue(
        loan.instalments[0] ? utcDateToIso(loan.instalments[0].dueDate) : null,
        today,
      );
      const admissibleCollateral = await this.security.admissibleForLoan(loan.id);
      const row = classifyLoan(outstanding, dpd, profile, admissibleCollateral);
      classified.push({ id: loan.id, ...row });
      await this.prisma.loan.update({
        where: { id: loan.id },
        data: {
          creditClass: row.creditClass,
          classifiedOn: isoToUtcDate(today),
        },
      });
    }

    const portfolio = classifyPortfolio(
      classified.map((c) => ({
        outstandingPrincipal: c.outstandingPrincipal,
        dpd: c.dpd,
        admissibleCollateral: c.admissibleCollateral,
      })),
      profile,
    );

    const day = isoToUtcDate(today);
    for (const bucket of portfolio.buckets) {
      await this.prisma.loanClassificationDaily.upsert({
        where: {
          companyId_day_creditClass: {
            companyId: requireCompanyId(),
            day,
            creditClass: bucket.creditClass,
          },
        },
        update: {
          loanCount: bucket.loanCount,
          outstandingPrincipal: bucket.outstandingPrincipal,
          requiredProvision: bucket.requiredProvision,
          recordedAt: new Date(),
        },
        create: {
          day,
          creditClass: bucket.creditClass,
          loanCount: bucket.loanCount,
          outstandingPrincipal: bucket.outstandingPrincipal,
          requiredProvision: bucket.requiredProvision,
        },
      });
    }

    const held = await this.ledger.loanLossAllowance();
    const required = portfolio.requiredProvision;
    const delta = required - held;
    let posted = 0n;
    if (delta !== 0n) {
      await this.prisma.$transaction(async (tx) => {
        await this.ledger.post(tx, {
          type: 'PROVISION',
          idempotencyKey: `provision:${today}:${held}:${required}`,
          effectiveOn: today,
          memo:
            delta > 0n
              ? `Loan-loss provision to BNR required level (${required})`
              : `Loan-loss allowance released to BNR required level (${required})`,
          lines: provisionAdjustmentLines(delta),
        });
      });
      posted = delta;
    }

    return {
      profile,
      loans: portfolio.loans,
      outstandingPrincipal: portfolio.outstandingPrincipal,
      requiredProvision: required,
      allowanceBefore: held,
      allowanceAfter: held + posted,
      provisionPosted: posted,
      nplBps: portfolio.nplBps,
      buckets: portfolio.buckets.map((b) => ({
        creditClass: b.creditClass,
        loanCount: b.loanCount,
        outstandingPrincipal: b.outstandingPrincipal.toString(),
        requiredProvision: b.requiredProvision.toString(),
      })),
    };
  }

  /** The end-of-day run for the current company. Safe to run more than once a day. */
  async nightly() {
    const today = kigaliDate();
    const accruals = await this.accrueInterest(today);
    const lateCharges = await this.chargeLateFees(today);
    const classification = await this.classifyAndProvision(today);
    const loans = await this.prisma.loan.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        code: true,
        officerId: true,
        principal: true,
        interestSuspendedAt: true,
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
      interestAccruals: {
        instalments: accruals.instalments,
        total: accruals.total.toString(),
        suspended: accruals.suspended,
        resumed: accruals.resumed,
      },
      lateCharges: { instalments: lateCharges.instalments, total: lateCharges.total.toString() },
      classification: {
        profile: classification.profile,
        loans: classification.loans,
        requiredProvision: classification.requiredProvision.toString(),
        provisionPosted: classification.provisionPosted.toString(),
        nplBps: classification.nplBps,
        buckets: classification.buckets,
      },
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
