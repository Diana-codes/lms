import { daysBetween, type IsoDate } from '../dates';
import { applyBps, divRoundHalfUp, type Rwf } from '../money';
import { dueDates } from './calendar';
import {
  annualRateBps,
  assertTerms,
  type FeeTiming,
  type LoanTerms,
  PERIODS_PER_YEAR,
} from './terms';

/**
 * The loan engine's schedule calculator. Integer arithmetic throughout:
 * money is whole francs (bigint), rates are basis points, and rounding
 * happens at named points only (each period's interest, the level
 * instalment, the fee split). Whatever rounding leaves over lands in the
 * last instalment, which always clears the balance exactly.
 */

export interface FeeCharge {
  code: string;
  name: string;
  timing: FeeTiming;
  thirdParty: boolean;
  /** The fee before VAT. */
  amount: Rwf;
  vat: Rwf;
}

export interface EngineRow {
  number: number;
  /** When it is due, after moving off weekends and holidays. */
  dueDate: IsoDate;
  /** The period end the interest was counted to (before moving). */
  periodEnd: IsoDate;
  principal: Rwf;
  interest: Rwf;
  /** SPREAD fees collected with this instalment, VAT included. */
  fee: Rwf;
  payment: Rwf;
  balanceAfter: Rwf;
}

/** How SPREAD fees split, for posting each collection to the right account. */
export interface SpreadFeeSplit {
  /** Everything collected through instalments. */
  total: Rwf;
  /** The lender's VAT in it. */
  vat: Rwf;
  /** Owed on to third parties (insurers and the like). */
  thirdParty: Rwf;
}

export interface LoanQuote {
  terms: LoanTerms;
  /** What the borrower asked for. */
  amount: Rwf;
  /** What the schedule repays: the amount plus any FINANCED fees. */
  principal: Rwf;
  /** What is paid out to the borrower: the amount less DEDUCTED fees. */
  netDisbursed: Rwf;
  fees: FeeCharge[];
  rows: EngineRow[];
  /** The regular instalment (most rows; the first and last can differ). */
  instalment: Rwf;
  totalInterest: Rwf;
  /** Every fee and its VAT, whoever it is for. */
  totalFees: Rwf;
  totalThirdParty: Rwf;
  totalVat: Rwf;
  /** Interest and the lender's own fees with their VAT: the cost of credit for the KFS. */
  totalCostOfCredit: Rwf;
  /** Everything the borrower pays: instalments plus fees paid separately. */
  totalRepayable: Rwf;
  spread: SpreadFeeSplit;
  /** Annual percentage rate, nominal (periodic rate × periods a year), basis points. */
  aprBps: number;
  /** The same cost as an effective annual rate, basis points. */
  effectiveAnnualBps: number;
}

export interface QuoteInput {
  amount: Rwf;
  /** Number of instalments. */
  count: number;
  terms: LoanTerms;
  disbursedOn: IsoDate;
  extraHolidays?: ReadonlySet<IsoDate>;
}

export const MAX_INSTALMENTS = 520;
const SCALE = 10n ** 30n;

/** One regular period's interest on a balance, rounded half up. */
export function periodInterest(balance: Rwf, terms: LoanTerms): Rwf {
  const ppy = BigInt(PERIODS_PER_YEAR[terms.frequency]);
  return divRoundHalfUp(balance * BigInt(annualRateBps(terms)), 10_000n * ppy);
}

/** Round half up to a multiple of `unit`. */
export function roundToUnit(amount: Rwf, unit: number): Rwf {
  if (unit <= 1) return amount;
  return divRoundHalfUp(amount, BigInt(unit)) * BigInt(unit);
}

/** The level instalment that repays `principal` over `periods` at the terms' periodic rate. */
export function levelInstalment(principal: Rwf, terms: LoanTerms, periods: number): Rwf {
  const annual = BigInt(annualRateBps(terms));
  const ppy = BigInt(PERIODS_PER_YEAR[terms.frequency]);
  if (annual === 0n) return divRoundHalfUp(principal, BigInt(periods));
  const onePlusR = SCALE + (SCALE * annual) / (10_000n * ppy);
  let growth = SCALE;
  for (let i = 0; i < periods; i++) growth = (growth * onePlusR) / SCALE;
  return divRoundHalfUp(principal * annual * growth, 10_000n * ppy * (growth - SCALE));
}

export function feeCharges(amount: Rwf, terms: LoanTerms): FeeCharge[] {
  return terms.fees.map((rule) => {
    let fee: Rwf = rule.basis === 'PERCENT' ? applyBps(amount, rule.value) : BigInt(rule.value);
    if (rule.basis === 'PERCENT') {
      if (rule.min != null && fee < BigInt(rule.min)) fee = BigInt(rule.min);
      if (rule.max != null && fee > BigInt(rule.max)) fee = BigInt(rule.max);
    }
    return {
      code: rule.code,
      name: rule.name,
      timing: rule.timing,
      thirdParty: rule.thirdParty,
      amount: fee,
      vat: rule.vat ? applyBps(fee, terms.vatBps) : 0n,
    };
  });
}

const gross = (f: FeeCharge) => f.amount + f.vat;
const sum = (xs: Rwf[]) => xs.reduce((a, b) => a + b, 0n);

/** Split `total` into `parts` whole-franc amounts; the last takes the remainder. */
function splitEvenly(total: Rwf, parts: number): Rwf[] {
  const each = total / BigInt(parts);
  const out = Array.from({ length: parts }, () => each);
  out[parts - 1] = total - each * BigInt(parts - 1);
  return out;
}

/**
 * Principal and interest per period, before fees. Shared by new schedules and
 * by rescheduling what is left of a loan.
 */
export function amortise(
  principal: Rwf,
  terms: LoanTerms,
  periods: number,
  gracePeriods: number,
): Array<{ principal: Rwf; interest: Rwf }> {
  const out: Array<{ principal: Rwf; interest: Rwf }> = [];
  const repaying = periods - gracePeriods;
  const unit = terms.roundingUnit;
  let balance = principal;

  const flatInterest = periodInterest(principal, terms);
  const level =
    terms.interestMethod === 'DECLINING_EQUAL_INSTALMENT'
      ? roundToUnit(levelInstalment(principal, terms, repaying), unit)
      : terms.interestMethod === 'FLAT'
        ? roundToUnit(divRoundHalfUp(principal, BigInt(repaying)) + flatInterest, unit)
        : 0n;
  const equalPrincipal = roundToUnit(divRoundHalfUp(principal, BigInt(repaying)), unit);

  for (let n = 1; n <= periods; n++) {
    const isLast = n === periods;
    const inGrace = n <= gracePeriods;
    const interest =
      terms.interestMethod === 'FLAT' ? flatInterest : periodInterest(balance, terms);
    let part: Rwf;
    if (isLast) part = balance;
    else if (inGrace || terms.interestMethod === 'INTEREST_ONLY') part = 0n;
    else if (terms.interestMethod === 'DECLINING_EQUAL_PRINCIPAL') part = equalPrincipal;
    else part = level - interest;
    if (part > balance) part = balance;
    if (part < 0n) part = 0n;
    balance -= part;
    out.push({ principal: part, interest });
  }
  return out;
}

/** The full quote for a loan: fees, schedule, totals and APR. */
export function quoteLoan(input: QuoteInput): LoanQuote {
  const { amount, count, terms, disbursedOn } = input;
  if (amount <= 0n) throw new RangeError('The amount must be positive');
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALMENTS) {
    throw new RangeError(`The number of instalments must be 1–${MAX_INSTALMENTS}`);
  }
  assertTerms(terms, count);

  const fees = feeCharges(amount, terms);
  const byTiming = (t: FeeTiming) => fees.filter((f) => f.timing === t);
  const financed = sum(byTiming('FINANCED').map(gross));
  const deducted = sum(byTiming('DEDUCTED').map(gross));
  const spreadFees = byTiming('SPREAD');
  const spreadTotal = sum(spreadFees.map(gross));
  const principal = amount + financed;
  if (deducted >= amount) throw new RangeError('Fees taken at disbursement exceed the amount');

  const { nominal, actual } = dueDates({
    disbursedOn,
    frequency: terms.frequency,
    count,
    dueDayOfMonth: terms.dueDayOfMonth,
    moveOffNonWorkingDays: terms.moveOffNonWorkingDays,
    extraHolidays: input.extraHolidays,
  });
  const parts = amortise(principal, terms, count, terms.principalGracePeriods);

  // A fixed due day makes the first period longer or shorter than the rest:
  // charge its interest for the days it actually runs.
  if (terms.dueDayOfMonth != null && parts[0]) {
    const days = BigInt(daysBetween(disbursedOn, nominal[0]!));
    const ppy = BigInt(PERIODS_PER_YEAR[terms.frequency]);
    parts[0].interest = divRoundHalfUp(parts[0].interest * days * ppy, 365n);
  }

  const feeParts = spreadTotal > 0n ? splitEvenly(spreadTotal, count) : [];
  let balance = principal;
  const rows: EngineRow[] = parts.map((p, i) => {
    balance -= p.principal;
    const fee = feeParts[i] ?? 0n;
    return {
      number: i + 1,
      dueDate: actual[i]!,
      periodEnd: nominal[i]!,
      principal: p.principal,
      interest: p.interest,
      fee,
      payment: p.principal + p.interest + fee,
      balanceAfter: balance,
    };
  });

  const totalInterest = sum(rows.map((r) => r.interest));
  const totalFees = sum(fees.map(gross));
  const totalThirdParty = sum(fees.filter((f) => f.thirdParty).map(gross));
  const totalVat = sum(fees.filter((f) => !f.thirdParty).map((f) => f.vat));
  const upfront = sum(byTiming('UPFRONT').map(gross));
  const spread: SpreadFeeSplit = {
    total: spreadTotal,
    vat: sum(spreadFees.filter((f) => !f.thirdParty).map((f) => f.vat)),
    thirdParty: sum(spreadFees.filter((f) => f.thirdParty).map(gross)),
  };

  const middle = rows.length > 2 ? rows[1]! : rows[0]!;
  const quote: LoanQuote = {
    terms,
    amount,
    principal,
    netDisbursed: amount - deducted,
    fees,
    rows,
    instalment: middle.payment,
    totalInterest,
    totalFees,
    totalThirdParty,
    totalVat,
    totalCostOfCredit: totalInterest + totalFees - totalThirdParty,
    totalRepayable: sum(rows.map((r) => r.payment)) + upfront,
    spread,
    aprBps: 0,
    effectiveAnnualBps: 0,
  };
  const apr = aprOf(quote, disbursedOn);
  quote.aprBps = apr.aprBps;
  quote.effectiveAnnualBps = apr.effectiveAnnualBps;
  return quote;
}

/**
 * The APR, as BNR Regulation 91/2025 defines it: the annualised rate that
 * equates what the borrower receives with what they pay, counting interest
 * and the lender's fees (with VAT) but not third-party costs. Cash flows are
 * placed on their actual dates (days / 365).
 */
export function aprOf(
  quote: Pick<LoanQuote, 'amount' | 'fees' | 'rows' | 'terms'>,
  disbursedOn: IsoDate,
): { aprBps: number; effectiveAnnualBps: number } {
  const lenderAt = (t: FeeTiming) =>
    quote.fees.filter((f) => !f.thirdParty && f.timing === t).map(gross);
  const financedThirdParty = quote.fees
    .filter((f) => f.thirdParty && f.timing === 'FINANCED')
    .map(gross);
  const received = Number(
    quote.amount + sum(financedThirdParty) - sum(lenderAt('DEDUCTED')) - sum(lenderAt('UPFRONT')),
  );
  const spreadThirdParty = sum(
    quote.fees.filter((f) => f.thirdParty && f.timing === 'SPREAD').map(gross),
  );
  const tpParts = spreadThirdParty > 0n ? splitEvenly(spreadThirdParty, quote.rows.length) : [];
  const flows = quote.rows.map((r, i) => ({
    years: daysBetween(disbursedOn, r.dueDate) / 365,
    amount: Number(r.payment - (tpParts[i] ?? 0n)),
  }));
  const paid = flows.reduce((a, f) => a + f.amount, 0);
  if (paid <= received) return { aprBps: 0, effectiveAnnualBps: 0 };

  const npv = (rate: number) =>
    received - flows.reduce((a, f) => a + f.amount / Math.pow(1 + rate, f.years), 0);
  let lo = 0;
  let hi = 1;
  while (npv(hi) < 0 && hi < 1e6) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) < 0) lo = mid;
    else hi = mid;
  }
  const effective = (lo + hi) / 2;
  const ppy = PERIODS_PER_YEAR[quote.terms.frequency];
  const nominal = ppy * (Math.pow(1 + effective, 1 / ppy) - 1);
  return {
    aprBps: Math.round(nominal * 10_000),
    effectiveAnnualBps: Math.round(effective * 10_000),
  };
}
