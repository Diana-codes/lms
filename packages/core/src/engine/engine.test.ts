import { describe, expect, it } from 'vitest';
import {
  allocate,
  dueDates,
  easterSunday,
  type InstalmentLedger,
  type LoanTerms,
  nextWorkingDay,
  payoffQuote,
  penaltyToCharge,
  quoteLoan,
  reschedule,
  RW_DEFAULT_TERMS,
  rwandaHolidays,
  termsProblems,
} from './index';

/** Plain terms to compare against textbook figures: no fees, no date moves. */
const plain = (over: Partial<LoanTerms> = {}): LoanTerms => ({
  ...RW_DEFAULT_TERMS,
  fees: [],
  moveOffNonWorkingDays: false,
  penalty: { method: 'NONE', graceDays: 0, amount: 0, bps: 0, capBps: null },
  ...over,
});

const sum = (xs: bigint[]) => xs.reduce((a, b) => a + b, 0n);

describe('schedules', () => {
  it('equal instalments match the annuity formula (1,000,000 at 24% a year, 12 months)', () => {
    // 1,000,000 × 0.02 / (1 − 1.02^−12) = 94,559.60
    const q = quoteLoan({
      amount: 1_000_000n,
      count: 12,
      terms: plain(),
      disbursedOn: '2026-01-15',
    });
    expect(q.instalment).toBe(94_560n);
    expect(q.rows[0]!.interest).toBe(20_000n);
    expect(q.rows[0]!.principal).toBe(74_560n);
    expect(sum(q.rows.map((r) => r.principal))).toBe(1_000_000n);
    expect(q.rows.at(-1)!.balanceAfter).toBe(0n);
    // The last instalment absorbs rounding: within a few francs of the rest.
    const last = q.rows.at(-1)!.payment;
    expect(last >= 94_555n && last <= 94_565n).toBe(true);
    expect(q.rows.map((r) => r.dueDate).slice(0, 3)).toEqual([
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
    ]);
  });

  it('a rate quoted per month is the same loan as 12× per year', () => {
    const monthly = quoteLoan({
      amount: 500_000n,
      count: 6,
      terms: plain({ rateBps: 200, ratePeriod: 'MONTH' }),
      disbursedOn: '2026-03-01',
    });
    const yearly = quoteLoan({
      amount: 500_000n,
      count: 6,
      terms: plain({ rateBps: 2400, ratePeriod: 'YEAR' }),
      disbursedOn: '2026-03-01',
    });
    expect(monthly.rows).toEqual(yearly.rows);
  });

  it('flat interest charges the original amount every period (3% a month, 6 months)', () => {
    const q = quoteLoan({
      amount: 1_000_000n,
      count: 6,
      terms: plain({ interestMethod: 'FLAT', rateBps: 300, ratePeriod: 'MONTH' }),
      disbursedOn: '2026-01-10',
    });
    expect(q.rows.every((r) => r.interest === 30_000n)).toBe(true);
    expect(q.totalInterest).toBe(180_000n);
    expect(q.instalment).toBe(196_667n);
    expect(sum(q.rows.map((r) => r.principal))).toBe(1_000_000n);
    expect(q.rows.at(-1)!.payment).toBe(196_665n);
  });

  it('equal principal: the same principal each period, falling interest', () => {
    const q = quoteLoan({
      amount: 1_200_000n,
      count: 4,
      terms: plain({ interestMethod: 'DECLINING_EQUAL_PRINCIPAL', rateBps: 1200 }),
      disbursedOn: '2026-01-10',
    });
    expect(q.rows.map((r) => r.principal)).toEqual([300_000n, 300_000n, 300_000n, 300_000n]);
    expect(q.rows.map((r) => r.interest)).toEqual([12_000n, 9_000n, 6_000n, 3_000n]);
  });

  it('interest only, then the principal at the end (and a single bullet repayment)', () => {
    const q = quoteLoan({
      amount: 600_000n,
      count: 3,
      terms: plain({ interestMethod: 'INTEREST_ONLY', rateBps: 2400 }),
      disbursedOn: '2026-01-10',
    });
    expect(q.rows.map((r) => r.principal)).toEqual([0n, 0n, 600_000n]);
    expect(q.rows.map((r) => r.interest)).toEqual([12_000n, 12_000n, 12_000n]);
    const bullet = quoteLoan({
      amount: 600_000n,
      count: 1,
      terms: plain({ interestMethod: 'INTEREST_ONLY', rateBps: 2400 }),
      disbursedOn: '2026-01-10',
    });
    expect(bullet.rows).toHaveLength(1);
    expect(bullet.rows[0]!.payment).toBe(612_000n);
  });

  it('weekly and fortnightly loans use the periodic rate and step in days', () => {
    const q = quoteLoan({
      amount: 520_000n,
      count: 4,
      terms: plain({ frequency: 'WEEKLY', rateBps: 5200 }),
      disbursedOn: '2026-01-05',
    });
    // 52% a year over 52 weeks is 1% a week.
    expect(q.rows[0]!.interest).toBe(5_200n);
    expect(q.rows.map((r) => r.dueDate)).toEqual([
      '2026-01-12',
      '2026-01-19',
      '2026-01-26',
      '2026-02-02',
    ]);
    const f = quoteLoan({
      amount: 260_000n,
      count: 2,
      terms: plain({ frequency: 'FORTNIGHTLY', rateBps: 2600 }),
      disbursedOn: '2026-01-05',
    });
    expect(f.rows[0]!.interest).toBe(2_600n);
    expect(f.rows[1]!.dueDate).toBe('2026-02-02');
  });

  it('a principal grace period charges interest only, then repays over the rest', () => {
    const q = quoteLoan({
      amount: 1_000_000n,
      count: 6,
      terms: plain({ principalGracePeriods: 2, rateBps: 1200 }),
      disbursedOn: '2026-01-10',
    });
    expect(q.rows.slice(0, 2).map((r) => r.principal)).toEqual([0n, 0n]);
    expect(q.rows.slice(0, 2).map((r) => r.interest)).toEqual([10_000n, 10_000n]);
    expect(sum(q.rows.map((r) => r.principal))).toBe(1_000_000n);
  });

  it('rounds instalments to the chosen unit, the last one taking the difference', () => {
    const q = quoteLoan({
      amount: 1_000_000n,
      count: 12,
      terms: plain({ roundingUnit: 100 }),
      disbursedOn: '2026-01-15',
    });
    expect(q.instalment).toBe(94_600n);
    expect(q.rows.slice(0, -1).every((r) => r.payment === 94_600n)).toBe(true);
    expect(sum(q.rows.map((r) => r.principal))).toBe(1_000_000n);
  });

  it('a fixed due day charges the first period for its actual days', () => {
    const q = quoteLoan({
      amount: 1_000_000n,
      count: 3,
      terms: plain({ dueDayOfMonth: 25, rateBps: 3650, moveOffNonWorkingDays: true }),
      disbursedOn: '2026-01-05',
    });
    // 5 Jan → 25 Jan is 20 days, over the 15-day minimum, so the first is in January.
    expect(q.rows[0]!.dueDate).toBe('2026-01-26'); // 25 Jan 2026 is a Sunday
    expect(q.rows[0]!.periodEnd).toBe('2026-01-25');
    // A regular month at 36.5% is 30,417; 20 days of it: 30,417 × 20 × 12 / 365 = 20,000.
    expect(q.rows[0]!.interest).toBe(20_000n);
    expect(q.rows[1]!.periodEnd).toBe('2026-02-25');
  });

  it('a fixed due day too close to disbursement moves to the next month', () => {
    const { nominal } = dueDates({
      disbursedOn: '2026-01-20',
      frequency: 'MONTHLY',
      count: 2,
      dueDayOfMonth: 25,
      moveOffNonWorkingDays: false,
    });
    expect(nominal).toEqual(['2026-02-25', '2026-03-25']);
  });

  it('month ends stay on the last day of short months', () => {
    const { nominal } = dueDates({
      disbursedOn: '2026-01-31',
      frequency: 'MONTHLY',
      count: 3,
      dueDayOfMonth: null,
      moveOffNonWorkingDays: false,
    });
    expect(nominal).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });
});

describe('Rwanda calendar', () => {
  it('knows the fixed holidays, Easter and Umuganura', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    const h = rwandaHolidays(2026);
    for (const d of ['2026-01-01', '2026-02-01', '2026-04-03', '2026-04-06', '2026-04-07']) {
      expect(h).toContain(d);
    }
    expect(h).toContain('2026-08-07'); // first Friday of August 2026
  });

  it('moves a due date off weekends and holidays', () => {
    expect(nextWorkingDay('2026-07-04')).toBe('2026-07-06'); // Liberation Day, a Saturday
    expect(nextWorkingDay('2026-12-25')).toBe('2026-12-28'); // Christmas Friday, then the weekend
    expect(nextWorkingDay('2026-03-10')).toBe('2026-03-10');
    expect(nextWorkingDay('2026-03-10', new Set(['2026-03-10']))).toBe('2026-03-11');
  });
});

describe('fees, VAT and APR', () => {
  it('with no fees, the APR is the nominal rate', () => {
    const q = quoteLoan({
      amount: 1_000_000n,
      count: 12,
      terms: plain(),
      disbursedOn: '2026-01-15',
    });
    expect(Math.abs(q.aprBps - 2400)).toBeLessThanOrEqual(15); // actual days vs 1/12 years
    expect(q.totalCostOfCredit).toBe(q.totalInterest);
  });

  it('a deducted processing fee with VAT lowers the payout and raises the APR', () => {
    const terms = plain({
      fees: [
        {
          code: 'processing',
          name: 'Processing fee',
          basis: 'PERCENT',
          value: 200,
          timing: 'DEDUCTED',
          thirdParty: false,
          vat: true,
        },
      ],
    });
    const q = quoteLoan({ amount: 1_000_000n, count: 12, terms, disbursedOn: '2026-01-15' });
    expect(q.fees[0]).toMatchObject({ amount: 20_000n, vat: 3_600n });
    expect(q.netDisbursed).toBe(976_400n);
    expect(q.principal).toBe(1_000_000n);
    expect(q.totalVat).toBe(3_600n);
    expect(q.totalCostOfCredit).toBe(q.totalInterest + 23_600n);
    // Borrowing 976,400 and repaying 12 × 94,560 is about 2.37% a month.
    expect(q.aprBps).toBeGreaterThan(2800);
    expect(q.aprBps).toBeLessThan(2900);
    expect(q.effectiveAnnualBps).toBeGreaterThan(q.aprBps);
  });

  it('leaves third-party costs (insurance) out of the APR and the cost of credit', () => {
    const insurance = {
      code: 'insurance',
      name: 'Credit life insurance',
      basis: 'PERCENT' as const,
      value: 100,
      timing: 'DEDUCTED' as const,
      thirdParty: true,
      vat: false,
    };
    const base = quoteLoan({
      amount: 1_000_000n,
      count: 12,
      terms: plain(),
      disbursedOn: '2026-01-15',
    });
    const q = quoteLoan({
      amount: 1_000_000n,
      count: 12,
      terms: plain({ fees: [insurance] }),
      disbursedOn: '2026-01-15',
    });
    expect(q.netDisbursed).toBe(990_000n);
    expect(q.totalThirdParty).toBe(10_000n);
    expect(q.aprBps).toBe(base.aprBps);
    expect(q.totalCostOfCredit).toBe(base.totalCostOfCredit);
  });

  it('a financed fee is repaid with the loan; a spread fee comes with each instalment', () => {
    const q = quoteLoan({
      amount: 1_000_000n,
      count: 4,
      terms: plain({
        rateBps: 0,
        fees: [
          {
            code: 'arrangement',
            name: 'Arrangement',
            basis: 'FIXED',
            value: 40_000,
            timing: 'FINANCED',
            thirdParty: false,
            vat: false,
          },
          {
            code: 'monitoring',
            name: 'Monitoring',
            basis: 'FIXED',
            value: 10_000,
            timing: 'SPREAD',
            thirdParty: false,
            vat: true,
          },
        ],
      }),
      disbursedOn: '2026-01-15',
    });
    expect(q.principal).toBe(1_040_000n);
    expect(q.netDisbursed).toBe(1_000_000n);
    expect(q.rows.map((r) => r.fee)).toEqual([2_950n, 2_950n, 2_950n, 2_950n]); // 11,800 / 4
    expect(q.spread).toEqual({ total: 11_800n, vat: 1_800n, thirdParty: 0n });
    expect(q.totalRepayable).toBe(1_040_000n + 11_800n);
    expect(q.aprBps).toBeGreaterThan(0);
  });

  it('applies fee minimums and maximums', () => {
    const fee = (min: number | null, max: number | null) =>
      plain({
        fees: [
          {
            code: 'processing',
            name: 'Processing',
            basis: 'PERCENT',
            value: 100,
            min,
            max,
            timing: 'UPFRONT',
            thirdParty: false,
            vat: false,
          },
        ],
      });
    const small = quoteLoan({
      amount: 100_000n,
      count: 1,
      terms: fee(5_000, null),
      disbursedOn: '2026-01-01',
    });
    expect(small.fees[0]!.amount).toBe(5_000n);
    const big = quoteLoan({
      amount: 50_000_000n,
      count: 1,
      terms: fee(null, 200_000),
      disbursedOn: '2026-01-01',
    });
    expect(big.fees[0]!.amount).toBe(200_000n);
    expect(big.netDisbursed).toBe(50_000_000n);
  });

  it('refuses fees larger than the loan, and invalid terms', () => {
    expect(() =>
      quoteLoan({
        amount: 10_000n,
        count: 1,
        terms: plain({
          fees: [
            {
              code: 'x',
              name: 'X',
              basis: 'FIXED',
              value: 20_000,
              timing: 'DEDUCTED',
              thirdParty: false,
              vat: false,
            },
          ],
        }),
        disbursedOn: '2026-01-01',
      }),
    ).toThrow(/exceed/);
    expect(
      termsProblems(plain({ allocationOrder: ['FEE', 'FEE', 'INTEREST', 'PRINCIPAL'] })),
    ).toContain('Payment order must list penalty, fee, interest and principal once each');
    expect(termsProblems(plain({ frequency: 'WEEKLY', dueDayOfMonth: 5 }))).toContain(
      'A fixed due day only works for monthly loans',
    );
    expect(termsProblems(RW_DEFAULT_TERMS)).toEqual([]);
  });
});

const ledger = (
  over: Partial<InstalmentLedger> & Pick<InstalmentLedger, 'number' | 'dueDate'>,
): InstalmentLedger => ({
  periodStart: '2026-01-01',
  principalDue: 0n,
  principalPaid: 0n,
  interestDue: 0n,
  interestPaid: 0n,
  feeDue: 0n,
  feePaid: 0n,
  penaltyDue: 0n,
  penaltyPaid: 0n,
  ...over,
});

describe('late charges', () => {
  const inst = ledger({
    number: 1,
    dueDate: '2026-03-10',
    principalDue: 90_000n,
    interestDue: 10_000n,
  });
  const base = {
    instalment: inst,
    accruedThrough: null,
    chargedOnLoan: 0n,
    loanPrincipal: 1_000_000n,
  };

  it('nothing within the grace days', () => {
    const r = penaltyToCharge({ ...base, terms: RW_DEFAULT_TERMS, asOf: '2026-03-13' });
    expect(r.charge).toBe(0n);
  });

  it('a daily rate on what is overdue, from the day after the grace period, never compounded', () => {
    // 24% a year on 100,000 overdue is 65.75 a day. Grace ends 13 Mar; to 23 Mar is 10 days.
    const r = penaltyToCharge({ ...base, terms: RW_DEFAULT_TERMS, asOf: '2026-03-23' });
    expect(r).toEqual({ charge: 658n, accruedThrough: '2026-03-23' });
    const next = penaltyToCharge({
      ...base,
      instalment: { ...inst, penaltyDue: 658n },
      accruedThrough: '2026-03-23',
      terms: RW_DEFAULT_TERMS,
      asOf: '2026-03-24',
    });
    expect(next.charge).toBe(66n); // on 100,000 again, not on 100,658
  });

  it('a fixed or one-off percentage charge, once per instalment', () => {
    const fixed = {
      ...RW_DEFAULT_TERMS,
      penalty: {
        ...RW_DEFAULT_TERMS.penalty,
        method: 'FIXED_PER_INSTALMENT' as const,
        amount: 5_000,
      },
    };
    expect(penaltyToCharge({ ...base, terms: fixed, asOf: '2026-03-20' }).charge).toBe(5_000n);
    expect(
      penaltyToCharge({ ...base, terms: fixed, asOf: '2026-03-21', accruedThrough: '2026-03-20' })
        .charge,
    ).toBe(0n);
    const pct = {
      ...RW_DEFAULT_TERMS,
      penalty: { ...RW_DEFAULT_TERMS.penalty, method: 'PERCENT_OF_OVERDUE' as const, bps: 500 },
    };
    expect(penaltyToCharge({ ...base, terms: pct, asOf: '2026-03-20' }).charge).toBe(5_000n);
  });

  it('stops at the cap', () => {
    const capped = { ...RW_DEFAULT_TERMS, penalty: { ...RW_DEFAULT_TERMS.penalty, capBps: 100 } };
    const r = penaltyToCharge({
      ...base,
      terms: capped,
      asOf: '2027-03-10',
      chargedOnLoan: 9_000n,
    });
    expect(r.charge).toBe(1_000n); // cap 10,000, 9,000 already charged
  });
});

describe('allocating payments', () => {
  const insts = [
    ledger({
      number: 1,
      dueDate: '2026-02-01',
      principalDue: 80_000n,
      interestDue: 20_000n,
      feeDue: 1_000n,
      penaltyDue: 500n,
    }),
    ledger({ number: 2, dueDate: '2026-03-01', principalDue: 82_000n, interestDue: 18_000n }),
  ];

  it('oldest instalment first, in the product order', () => {
    const r = allocate(insts, 21_000n, ['PENALTY', 'FEE', 'INTEREST', 'PRINCIPAL']);
    expect(r.allocations).toEqual([
      {
        number: 1,
        amounts: { PENALTY: 500n, FEE: 1_000n, INTEREST: 19_500n, PRINCIPAL: 0n },
        settles: false,
      },
    ]);
    const p = allocate(insts, 21_000n, ['PRINCIPAL', 'INTEREST', 'FEE', 'PENALTY']);
    expect(p.allocations[0]!.amounts).toEqual({
      PENALTY: 0n,
      FEE: 0n,
      INTEREST: 0n,
      PRINCIPAL: 21_000n,
    });
  });

  it('settles instalments in turn and reports what is left', () => {
    const r = allocate(insts, 250_000n, RW_DEFAULT_TERMS.allocationOrder);
    expect(r.allocations.map((a) => a.settles)).toEqual([true, true]);
    expect(r.left).toBe(250_000n - 101_500n - 100_000n);
  });
});

describe('paying off early', () => {
  const insts = [
    ledger({
      number: 2,
      periodStart: '2026-02-01',
      dueDate: '2026-03-01',
      principalDue: 80_000n,
      interestDue: 28_000n,
    }),
    ledger({
      number: 3,
      periodStart: '2026-03-01',
      dueDate: '2026-04-01',
      principalDue: 82_000n,
      interestDue: 20_000n,
    }),
  ];

  it('interest to the payoff day only, by default', () => {
    // 15 Feb is 14 of the 28 days of instalment 2's period.
    const q = payoffQuote(insts, RW_DEFAULT_TERMS, '2026-02-15');
    expect(q.currentInterest).toBe(14_000n);
    expect(q.principal).toBe(162_000n);
    expect(q.waived).toBe(34_000n);
    expect(q.total).toBe(176_000n);
  });

  it('the current period in full, or all scheduled interest, if the product says so', () => {
    const current = {
      ...RW_DEFAULT_TERMS,
      payoff: { ...RW_DEFAULT_TERMS.payoff, interest: 'CURRENT_PERIOD' as const },
    };
    expect(payoffQuote(insts, current, '2026-02-15').total).toBe(190_000n);
    const all = {
      ...RW_DEFAULT_TERMS,
      payoff: { ...RW_DEFAULT_TERMS.payoff, interest: 'ALL_SCHEDULED' as const },
    };
    expect(payoffQuote(insts, all, '2026-02-15').total).toBe(210_000n);
  });

  it('adds arrears and an early repayment fee with VAT', () => {
    const terms = {
      ...RW_DEFAULT_TERMS,
      payoff: { interest: 'ACCRUED_TO_DATE' as const, feeBps: 200, feeVat: true },
    };
    const q = payoffQuote(insts, terms, '2026-03-10');
    expect(q.arrears.PRINCIPAL).toBe(80_000n);
    expect(q.arrears.INTEREST).toBe(28_000n);
    expect(q.fee).toBe(1_640n); // 2% of 82,000
    expect(q.feeVat).toBe(295n);
  });
});

describe('rescheduling after a prepayment', () => {
  const terms = plain({ rateBps: 1200 });
  const q = quoteLoan({ amount: 1_200_000n, count: 12, terms, disbursedOn: '2026-01-10' });
  const future = q.rows.slice(3).map((r, i) => ({
    number: r.number,
    periodStart: q.rows[i + 2]!.dueDate,
    dueDate: r.dueDate,
    principal: r.principal,
    interest: r.interest,
    fee: r.fee,
  }));
  const remaining = sum(future.map((r) => r.principal));

  it('reduce term: same instalment, fewer instalments', () => {
    const rows = reschedule(future, remaining - 300_000n, terms, 'REDUCE_TERM');
    expect(rows.length).toBeLessThan(future.length);
    expect(rows[0]!.principal + rows[0]!.interest).toBe(q.instalment);
    expect(sum(rows.map((r) => r.principal))).toBe(remaining - 300_000n);
  });

  it('reduce instalment: same number of instalments, each smaller', () => {
    const rows = reschedule(future, remaining - 300_000n, terms, 'REDUCE_INSTALMENT');
    expect(rows).toHaveLength(future.length);
    expect(rows[0]!.principal + rows[0]!.interest).toBeLessThan(q.instalment);
    expect(sum(rows.map((r) => r.principal))).toBe(remaining - 300_000n);
  });
});
