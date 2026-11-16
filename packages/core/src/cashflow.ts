import { addDays, daysBetween, type IsoDate } from './dates';
import type { Rwf } from './money';

/**
 * AI cash-flow analysis (PRD §6.15): the arithmetic. Extraction (CSV parsing
 * or Claude reading a PDF/photo) produces transactions; everything here is
 * deterministic and explainable, and every figure lists the transactions it
 * came from. The result is advice for a credit analyst, never a decision.
 */

export const CASHFLOW_MODEL_VERSION = 'cashflow-rules-v1';

export const CASHFLOW_CATEGORIES = [
  'SALARY',
  'BUSINESS_SALES',
  'TRANSFER_IN',
  'LOAN_RECEIVED',
  'LOAN_REPAYMENT',
  'RENT',
  'SCHOOL_FEES',
  'UTILITIES',
  'CASH_WITHDRAWAL',
  'BETTING',
  'TRANSFER_OUT',
  'PURCHASES',
  'FEES_CHARGES',
  'OTHER_IN',
  'OTHER_OUT',
] as const;
export type CashflowCategory = (typeof CASHFLOW_CATEGORIES)[number];

export const CASHFLOW_CATEGORY_LABELS: Record<CashflowCategory, string> = {
  SALARY: 'Salary',
  BUSINESS_SALES: 'Business sales',
  TRANSFER_IN: 'Transfers in from people',
  LOAN_RECEIVED: 'Loans received',
  LOAN_REPAYMENT: 'Repayments to other lenders',
  RENT: 'Rent',
  SCHOOL_FEES: 'School fees',
  UTILITIES: 'Utilities and airtime',
  CASH_WITHDRAWAL: 'Cash withdrawals',
  BETTING: 'Betting',
  TRANSFER_OUT: 'Transfers out to people',
  PURCHASES: 'Purchases and payments',
  FEES_CHARGES: 'Bank and MoMo charges',
  OTHER_IN: 'Other money in',
  OTHER_OUT: 'Other money out',
};

/** Money that counts as income for affordability. Loans received do not. */
export const INCOME_CATEGORIES: ReadonlySet<CashflowCategory> = new Set([
  'SALARY',
  'BUSINESS_SALES',
  'TRANSFER_IN',
  'OTHER_IN',
]);
/** Regular commitments that come before a new instalment. */
export const COMMITMENT_CATEGORIES: ReadonlySet<CashflowCategory> = new Set([
  'RENT',
  'SCHOOL_FEES',
  'UTILITIES',
]);

export interface CashflowTxn {
  id: string;
  date: IsoDate;
  description: string;
  /** Always positive; `direction` says which way it went. */
  amount: Rwf;
  direction: 'IN' | 'OUT';
  /** Running balance after this transaction, when the statement shows one. */
  balance: Rwf | null;
  category: CashflowCategory;
  documentId: string;
}

const RULES: Array<{ category: CashflowCategory; dir: 'IN' | 'OUT' | 'ANY'; words: RegExp }> = [
  {
    category: 'LOAN_RECEIVED',
    dir: 'IN',
    words: /\b(loan|mokash|quick ?loan|advance|credit disburs|inguzanyo)\b/i,
  },
  {
    category: 'LOAN_REPAYMENT',
    dir: 'OUT',
    words:
      /\b(loan|mokash|repay|instal+ment|kwishyura inguzanyo|airtel ?loan|momo ?advance|equity|bk |cogebanque|umurenge sacco)\b/i,
  },
  { category: 'SALARY', dir: 'IN', words: /\b(salary|salaire|payroll|umushahara|wage|sal\b)/i },
  {
    category: 'BETTING',
    dir: 'OUT',
    words: /\b(bet|betpawa|sportpesa|gorilla ?games|premier ?bet|lottery|casino)\b/i,
  },
  { category: 'RENT', dir: 'OUT', words: /\b(rent|loyer|ubukode|landlord)\b/i },
  {
    category: 'SCHOOL_FEES',
    dir: 'OUT',
    words: /\b(school|fees|ishuri|minerval|tuition|college|university)\b/i,
  },
  {
    category: 'UTILITIES',
    dir: 'OUT',
    words:
      /\b(eucl|cash ?power|electricity|wasac|water|canal|startimes|dstv|airtime|bundle|internet|irembo)\b/i,
  },
  { category: 'CASH_WITHDRAWAL', dir: 'OUT', words: /\b(withdraw|cash ?out|atm|agent)\b/i },
  { category: 'FEES_CHARGES', dir: 'OUT', words: /\b(fee|charge|commission|levy|tax)\b/i },
  {
    category: 'BUSINESS_SALES',
    dir: 'IN',
    words: /\b(momo ?pay|merchant|payment received|sale|pos|customer|invoice)\b/i,
  },
  {
    category: 'TRANSFER_IN',
    dir: 'IN',
    words: /\b(received from|transfer from|from \+?250|deposit|p2p)\b/i,
  },
  { category: 'TRANSFER_OUT', dir: 'OUT', words: /\b(sent to|transfer to|to \+?250|p2p)\b/i },
  {
    category: 'PURCHASES',
    dir: 'OUT',
    words: /\b(payment to|paid to|purchase|supermarket|shop|pharmacy|fuel)\b/i,
  },
];

/** A first guess at a transaction's category from its description. Analysts can change it. */
export function categorise(description: string, direction: 'IN' | 'OUT'): CashflowCategory {
  for (const rule of RULES) {
    if (rule.dir !== 'ANY' && rule.dir !== direction) continue;
    if (rule.words.test(description)) return rule.category;
  }
  return direction === 'IN' ? 'OTHER_IN' : 'OTHER_OUT';
}

export interface PayslipFacts {
  documentId: string;
  employer: string | null;
  employeeName: string | null;
  payPeriod: string | null;
  gross: Rwf | null;
  deductions: Rwf | null;
  net: Rwf | null;
}

export interface CashflowSettings {
  /** Debt-service ratio in basis points (35% = 3500). */
  dsrBps: number;
  /** Months of statements the product asks for. */
  minMonths: number;
  /** A single deposit this many times the average monthly income is flagged. */
  largeDepositMultiple: number;
  /** ... when it lands this many days before the application. */
  largeDepositWindowDays: number;
}

export const DEFAULT_CASHFLOW_SETTINGS: CashflowSettings = {
  dsrBps: 3500,
  minMonths: 6,
  largeDepositMultiple: 3,
  largeDepositWindowDays: 60,
};

export type FlagCode =
  | 'BALANCE_BREAK'
  | 'SHORT_PERIOD'
  | 'MISSING_MONTHS'
  | 'LARGE_RECENT_DEPOSIT'
  | 'NAME_MISMATCH'
  | 'PAYSLIP_MISMATCH'
  | 'DUPLICATE_DOCUMENT'
  | 'BETTING'
  | 'OTHER_LENDERS';

export interface CashflowFlag {
  code: FlagCode;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  /** Transaction ids (or document ids) that show it. */
  evidence: string[];
}

export interface Figure {
  value: Rwf;
  /** HIGH: read from a CSV with balances; MEDIUM: read by AI or no balances; LOW: thin data. */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** The transactions this figure is calculated from. */
  sources: string[];
}

export interface MonthTotals {
  month: string; // YYYY-MM
  income: Rwf;
  outflow: Rwf;
}

export interface CashflowReport {
  modelVersion: string;
  from: IsoDate | null;
  to: IsoDate | null;
  monthsCovered: number;
  months: MonthTotals[];
  averageIncome: Figure;
  lowestMonthIncome: Rwf;
  highestMonthIncome: Rwf;
  monthsWithIncome: number;
  /** Month-to-month variation of income, basis points of the average (lower is steadier). */
  variationBps: number;
  incomeBySource: Array<{ category: CashflowCategory; total: Rwf; shareBps: number }>;
  largestSourceShareBps: number;
  recurringCommitments: Figure;
  existingDebtRepayments: Figure;
  netDisposable: Figure;
  /** Suggested instalment range, from a cautious to the DSR limit. */
  affordable: { low: Rwf; high: Rwf; dsrBps: number };
  payslipNet: Rwf | null;
  salaryCredits: Rwf | null;
  flags: CashflowFlag[];
  /** Plain-language summary for the analyst. */
  summary: string;
}

const monthOf = (d: IsoDate) => d.slice(0, 7);
const avg = (xs: bigint[]) => (xs.length ? xs.reduce((s, x) => s + x, 0n) / BigInt(xs.length) : 0n);
const fmt = (v: bigint) => `RWF ${v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

function monthsBetween(from: IsoDate, to: IsoDate): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Statement rows whose running balance does not follow from the one before. */
export function balanceBreaks(txns: CashflowTxn[]): string[] {
  const out: string[] = [];
  const byDoc = new Map<string, CashflowTxn[]>();
  for (const t of txns) byDoc.set(t.documentId, [...(byDoc.get(t.documentId) ?? []), t]);
  for (const rows of byDoc.values()) {
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      if (prev.balance == null || cur.balance == null) continue;
      const expected =
        cur.direction === 'IN' ? prev.balance + cur.amount : prev.balance - cur.amount;
      if (expected !== cur.balance) out.push(cur.id);
    }
  }
  return out;
}

/** Simple word overlap between two names, ignoring case and order. */
export function namesMatch(a: string, b: string): boolean {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^a-z]+/)
        .filter((w) => w.length > 1),
    );
  const x = words(a);
  const y = words(b);
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common >= Math.min(2, Math.min(x.size, y.size));
}

export interface AnalyseInput {
  txns: CashflowTxn[];
  payslips: PayslipFacts[];
  /** Names on the documents, to compare with the borrower. */
  holderNames: Array<{ documentId: string; name: string }>;
  borrowerName: string;
  /** Documents whose file was also uploaded for another borrower. */
  duplicateDocumentIds: string[];
  /** Documents read by AI rather than parsed from a structured export. */
  aiReadDocumentIds: string[];
  applicationDate: IsoDate;
  settings?: Partial<CashflowSettings>;
}

/** Build the report an analyst reviews. Pure: same input, same report. */
export function analyseCashflow(input: AnalyseInput): CashflowReport {
  const s = { ...DEFAULT_CASHFLOW_SETTINGS, ...input.settings };
  const txns = [...input.txns].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const from = txns[0]?.date ?? null;
  const to = txns[txns.length - 1]?.date ?? null;
  const allMonths = from && to ? monthsBetween(from, to) : [];
  const flags: CashflowFlag[] = [];

  const incomeTx = txns.filter((t) => t.direction === 'IN' && INCOME_CATEGORIES.has(t.category));
  const months: MonthTotals[] = allMonths.map((m) => ({
    month: m,
    income: incomeTx.filter((t) => monthOf(t.date) === m).reduce((x, t) => x + t.amount, 0n),
    outflow: txns
      .filter((t) => t.direction === 'OUT' && monthOf(t.date) === m)
      .reduce((x, t) => x + t.amount, 0n),
  }));
  // Partial first and last months understate income; use full months when there are enough.
  const full = months.length > 3 ? months.slice(1, -1) : months;
  const incomes = full.map((m) => m.income);
  const averageIncome = avg(incomes);
  const monthsWithIncome = months.filter((m) => m.income > 0n).length;
  const mean = Number(averageIncome);
  const variance =
    incomes.length > 1
      ? incomes.reduce((x, v) => x + (Number(v) - mean) ** 2, 0) / incomes.length
      : 0;
  const variationBps = mean > 0 ? Math.round((Math.sqrt(variance) / mean) * 10_000) : 0;

  const totalIncome = incomeTx.reduce((x, t) => x + t.amount, 0n);
  const bySource = new Map<CashflowCategory, bigint>();
  for (const t of incomeTx) bySource.set(t.category, (bySource.get(t.category) ?? 0n) + t.amount);
  const incomeBySource = [...bySource.entries()]
    .map(([category, total]) => ({
      category,
      total,
      shareBps: totalIncome > 0n ? Number((total * 10_000n) / totalIncome) : 0,
    }))
    .sort((a, b) => (b.total > a.total ? 1 : -1));

  const perMonth = (cats: ReadonlySet<CashflowCategory>) => {
    const rows = txns.filter((t) => t.direction === 'OUT' && cats.has(t.category));
    const n = BigInt(Math.max(1, full.length));
    const fullSet = new Set(full.map((m) => m.month));
    const inFull = rows.filter((t) => fullSet.has(monthOf(t.date)));
    return { value: inFull.reduce((x, t) => x + t.amount, 0n) / n, sources: rows.map((t) => t.id) };
  };
  const commitments = perMonth(COMMITMENT_CATEGORIES);
  const debt = perMonth(new Set<CashflowCategory>(['LOAN_REPAYMENT']));
  const netDisposable = averageIncome - commitments.value - debt.value;
  const dsrLimit = (averageIncome * BigInt(s.dsrBps)) / 10_000n - debt.value;
  const high = dsrLimit > 0n ? (dsrLimit < netDisposable ? dsrLimit : netDisposable) : 0n;
  const affordableHigh = high > 0n ? high : 0n;
  const affordableLow = (affordableHigh * 7n) / 10n;

  // ── integrity and risk flags ──
  const breaks = balanceBreaks(txns);
  if (breaks.length) {
    flags.push({
      code: 'BALANCE_BREAK',
      severity: 'HIGH',
      message: `${breaks.length} transaction${breaks.length === 1 ? '' : 's'} do not follow from the previous balance: possible edits or missing rows`,
      evidence: breaks,
    });
  }
  if (allMonths.length && allMonths.length < s.minMonths) {
    flags.push({
      code: 'SHORT_PERIOD',
      severity: 'MEDIUM',
      message: `Statements cover ${allMonths.length} month${allMonths.length === 1 ? '' : 's'}; ${s.minMonths} are asked for`,
      evidence: [],
    });
  }
  const empty = months.filter((m) => m.income === 0n && m.outflow === 0n).map((m) => m.month);
  if (empty.length) {
    flags.push({
      code: 'MISSING_MONTHS',
      severity: 'MEDIUM',
      message: `No transactions in ${empty.join(', ')}: pages or months may be missing`,
      evidence: [],
    });
  }
  // Compared with the median month, so one big deposit cannot raise its own bar.
  const sorted = [...months.map((m) => m.income)].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const typical = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)]! : 0n;
  if (typical > 0n) {
    const since = addDays(input.applicationDate, -s.largeDepositWindowDays);
    const big = incomeTx.filter(
      (t) =>
        t.date >= since &&
        daysBetween(t.date, input.applicationDate) >= 0 &&
        t.amount > typical * BigInt(s.largeDepositMultiple),
    );
    if (big.length) {
      flags.push({
        code: 'LARGE_RECENT_DEPOSIT',
        severity: 'MEDIUM',
        message: `${big.length} deposit${big.length === 1 ? '' : 's'} over ${s.largeDepositMultiple}× the usual monthly income shortly before applying`,
        evidence: big.map((t) => t.id),
      });
    }
  }
  const mismatched = input.holderNames.filter(
    (h) => h.name && !namesMatch(h.name, input.borrowerName),
  );
  if (mismatched.length) {
    flags.push({
      code: 'NAME_MISMATCH',
      severity: 'HIGH',
      message: `The name on ${mismatched.length === 1 ? 'a document' : `${mismatched.length} documents`} does not match the borrower (${mismatched.map((m) => `"${m.name}"`).join(', ')})`,
      evidence: mismatched.map((m) => m.documentId),
    });
  }
  if (input.duplicateDocumentIds.length) {
    flags.push({
      code: 'DUPLICATE_DOCUMENT',
      severity: 'HIGH',
      message: 'The same file was uploaded for a different borrower',
      evidence: input.duplicateDocumentIds,
    });
  }
  const salary = txns.filter((t) => t.direction === 'IN' && t.category === 'SALARY');
  const salaryAvg = salary.length ? avg(salary.map((t) => t.amount)) : null;
  const nets = input.payslips.map((p) => p.net).filter((n): n is bigint => n != null);
  const payslipNet = nets.length ? avg(nets) : null;
  if (payslipNet != null && salaryAvg != null) {
    const diff = payslipNet > salaryAvg ? payslipNet - salaryAvg : salaryAvg - payslipNet;
    if (diff * 10n > payslipNet) {
      flags.push({
        code: 'PAYSLIP_MISMATCH',
        severity: 'HIGH',
        message: `Payslip net pay (${fmt(payslipNet)}) differs from salary received (${fmt(salaryAvg)}) by more than 10%`,
        evidence: [...input.payslips.map((p) => p.documentId), ...salary.map((t) => t.id)],
      });
    }
  }
  const betting = txns.filter((t) => t.category === 'BETTING');
  if (betting.length) {
    flags.push({
      code: 'BETTING',
      severity: 'LOW',
      message: `${betting.length} betting payment${betting.length === 1 ? '' : 's'} (${fmt(betting.reduce((x, t) => x + t.amount, 0n))})`,
      evidence: betting.map((t) => t.id),
    });
  }
  if (debt.value > 0n) {
    flags.push({
      code: 'OTHER_LENDERS',
      severity: 'LOW',
      message: `Repays other lenders about ${fmt(debt.value)} a month, which may not show on a credit bureau report`,
      evidence: debt.sources,
    });
  }

  // Confidence: low for short periods or when integrity checks failed; medium
  // when the figures were read by AI or the statement shows no balances.
  const aiRead = new Set(input.aiReadDocumentIds);
  const anyAi = txns.some((t) => aiRead.has(t.documentId));
  const hasBalances = txns.some((t) => t.balance != null);
  const thin = allMonths.length < s.minMonths || full.length < 3;
  const integrity = flags.some(
    (f) => f.severity === 'HIGH' && f.code !== 'PAYSLIP_MISMATCH' && f.code !== 'NAME_MISMATCH',
  );
  const confidence: Figure['confidence'] =
    thin || integrity ? 'LOW' : anyAi || !hasBalances ? 'MEDIUM' : 'HIGH';

  const steadiness =
    variationBps <= 2500 ? 'steady' : variationBps <= 5000 ? 'somewhat uneven' : 'very uneven';
  const summary = txns.length
    ? [
        `${allMonths.length} month${allMonths.length === 1 ? '' : 's'} of transactions (${from} to ${to}).`,
        `Average monthly income ${fmt(averageIncome)}, ${steadiness}; money came in during ${monthsWithIncome} of ${months.length} months.`,
        incomeBySource[0]
          ? `${Math.round(incomeBySource[0].shareBps / 100)}% of income is ${CASHFLOW_CATEGORY_LABELS[incomeBySource[0].category].toLowerCase()}.`
          : 'No income was identified.',
        `Regular commitments about ${fmt(commitments.value)} and other loan repayments about ${fmt(debt.value)} a month leave about ${fmt(netDisposable > 0n ? netDisposable : 0n)}.`,
        affordableHigh > 0n
          ? `A new instalment of ${fmt(affordableLow)}–${fmt(affordableHigh)} a month would fit the ${s.dsrBps / 100}% debt-service limit.`
          : 'No new instalment fits the debt-service limit on these figures.',
        flags.some((f) => f.severity === 'HIGH')
          ? 'There are high-severity flags to review before relying on these figures.'
          : '',
      ]
        .filter(Boolean)
        .join(' ')
    : 'No transactions could be read from the documents. Continue with a manual review.';

  return {
    modelVersion: CASHFLOW_MODEL_VERSION,
    from,
    to,
    monthsCovered: allMonths.length,
    months,
    averageIncome: { value: averageIncome, confidence, sources: incomeTx.map((t) => t.id) },
    lowestMonthIncome: incomes.length ? incomes.reduce((a, b) => (b < a ? b : a)) : 0n,
    highestMonthIncome: incomes.length ? incomes.reduce((a, b) => (b > a ? b : a)) : 0n,
    monthsWithIncome,
    variationBps,
    incomeBySource,
    largestSourceShareBps: incomeBySource[0]?.shareBps ?? 0,
    recurringCommitments: { value: commitments.value, confidence, sources: commitments.sources },
    existingDebtRepayments: { value: debt.value, confidence, sources: debt.sources },
    netDisposable: {
      value: netDisposable,
      confidence,
      sources: [...incomeTx.map((t) => t.id), ...commitments.sources, ...debt.sources],
    },
    affordable: { low: affordableLow, high: affordableHigh, dsrBps: s.dsrBps },
    payslipNet,
    salaryCredits: salaryAvg,
    flags,
    summary,
  };
}

/**
 * Read a bank or mobile-money statement exported as CSV. Finds the date,
 * description, amount (or money in / money out) and balance columns by their
 * headers, so it works across the common layouts. Returns null when the
 * layout is not recognised (the file then goes to AI reading or manual review).
 */
export function parseStatementCsv(
  rows: string[][],
  documentId: string,
): Array<Omit<CashflowTxn, 'id' | 'category'>> | null {
  const headerAt = rows.findIndex((r) => r.some((c) => /date/i.test(c)));
  if (headerAt < 0) return null;
  const header = rows[headerAt]!.map((h) => h.trim().toLowerCase());
  const find = (re: RegExp) => header.findIndex((h) => re.test(h));
  const date = find(/date|time/);
  const desc = find(/desc|detail|narrat|particular|remark|from|to|type/);
  const amount = find(/^amount|transaction amount/);
  const credit = find(/credit|money in|received|deposit|paid in|in \(rwf\)/);
  const debit = find(/debit|money out|sent|withdraw|paid out|out \(rwf\)/);
  const balance = find(/balance/);
  const directionCol = find(/^(direction|dr\/cr|type)$/);
  if (date < 0 || (amount < 0 && credit < 0 && debit < 0)) return null;

  const num = (v: string | undefined) => {
    const t = (v ?? '').replace(/[,\s]|RWF/gi, '');
    if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
    return BigInt(Math.round(Number(t)));
  };
  const out: Array<Omit<CashflowTxn, 'id' | 'category'>> = [];
  for (const r of rows.slice(headerAt + 1)) {
    const d = parseStatementDate(r[date] ?? '');
    if (!d) continue;
    let value: bigint | null = null;
    let direction: 'IN' | 'OUT' = 'IN';
    const c = credit >= 0 ? num(r[credit]) : null;
    const dbt = debit >= 0 ? num(r[debit]) : null;
    if (c != null && c !== 0n) {
      value = c < 0n ? -c : c;
      direction = 'IN';
    } else if (dbt != null && dbt !== 0n) {
      value = dbt < 0n ? -dbt : dbt;
      direction = 'OUT';
    } else if (amount >= 0) {
      const a = num(r[amount]);
      if (a == null || a === 0n) continue;
      const marker = directionCol >= 0 ? (r[directionCol] ?? '').toLowerCase() : '';
      direction = a < 0n || /^(dr|debit|out|sent|withdraw)/.test(marker) ? 'OUT' : 'IN';
      value = a < 0n ? -a : a;
    }
    if (value == null) continue;
    out.push({
      date: d,
      description: (desc >= 0 ? (r[desc] ?? '') : '').trim(),
      amount: value,
      direction,
      balance: balance >= 0 ? num(r[balance]) : null,
      documentId,
    });
  }
  return out.length ? out : null;
}

/** Dates as statements print them: 2026-05-04, 04/05/2026, 4-May-2026, with or without a time. */
export function parseStatementDate(value: string): IsoDate | null {
  const v = value.trim().split(/[ T]/)[0] ?? '';
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return valid(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(v);
  if (m) return valid(year(+m[3]!), +m[2]!, +m[1]!);
  m = /^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s](\d{2,4})$/.exec(
    value.trim().split(/\s\d{1,2}:/)[0]!,
  );
  if (m) {
    const mon = MONTHS.indexOf(m[2]!.toLowerCase().slice(0, 3)) + 1;
    if (mon > 0) return valid(year(+m[3]!), mon, +m[1]!);
  }
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const year = (y: number) => (y < 100 ? 2000 + y : y);
function valid(y: number, m: number, d: number): IsoDate | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
