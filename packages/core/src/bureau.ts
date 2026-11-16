/**
 * Credit bureau reporting (PRD §15.6, Appendix A.11): every loan, every
 * month, to the licensed credit reference bureau(s) the lender reports to.
 *
 * The file is a pipe-delimited data file with a header (H), one data row per
 * loan (D) and a trailer (T) with the record count and balance total, the
 * layout Rwandan bureaus have used for monthly loan data. Each bureau
 * publishes its own data specification and updates it from time to time, so
 * the columns live in one list here (BUREAU_COLUMNS): before the first live
 * submission, the lender's compliance officer should check them against the
 * bureau's current specification and the bureau's test upload.
 */
import { addDays, type IsoDate } from './dates';
import type { CreditClass } from './classification';
import type { Rwf } from './money';

export const BUREAU_FORMAT_VERSION = 'kora-crb-v1';

export type BureauAccountStatus = 'ACTIVE' | 'CLOSED' | 'WRITTEN_OFF';

export interface BureauLoanRecord {
  // ── the borrower ──
  borrowerType: 'INDIVIDUAL' | 'BUSINESS';
  /** Individuals: full name. Businesses: the registered name. */
  name: string;
  /** Individuals: the 16-digit national ID, decrypted only to build the file. */
  nationalId: string | null;
  /** Businesses: RDB company code. */
  registrationNumber: string | null;
  dateOfBirth: IsoDate | null;
  gender: 'FEMALE' | 'MALE' | 'OTHER' | 'UNDISCLOSED' | null;
  /** E.164, e.g. +250788123412. */
  phone: string;
  district: string | null;
  customerNumber: string;

  // ── the loan ──
  accountNumber: string;
  productName: string;
  dateOpened: IsoDate;
  maturityDate: IsoDate;
  termMonths: number;
  principal: Rwf;
  instalmentAmount: Rwf;
  /** Principal and accrued interest still owed at the end of the period. */
  currentBalance: Rwf;
  arrearsAmount: Rwf;
  daysInArrears: number;
  creditClass: CreditClass;
  status: BureauAccountStatus;
  closedOn: IsoDate | null;
  writtenOffOn: IsoDate | null;
  writtenOffAmount: Rwf;
  lastPaymentDate: IsoDate | null;
  lastPaymentAmount: Rwf;
  collateralType: string | null;
  collateralValue: Rwf;
  guarantorCount: number;
}

export interface BureauHeader {
  /** The lender's member code at the bureau. */
  lenderCode: string;
  lenderName: string;
  /** The month reported, as its last day. */
  periodEnd: IsoDate;
  /** When the file was built (Kigali date). */
  createdOn: IsoDate;
}

const STATUS_CODE: Record<BureauAccountStatus, string> = {
  ACTIVE: 'A',
  CLOSED: 'C',
  WRITTEN_OFF: 'W',
};
/** BNR 59/2023 classes, as the bureau's performance codes. */
const CLASS_CODE: Record<CreditClass, string> = {
  NORMAL: 'N',
  WATCH: 'W',
  SUBSTANDARD: 'S',
  DOUBTFUL: 'D',
  LOSS: 'L',
};
/** Bureaus record F or M; anything else is reported as unknown. */
const GENDER_CODE = { FEMALE: 'F', MALE: 'M', OTHER: 'U', UNDISCLOSED: 'U' } as const;

const ymd = (d: IsoDate | null) => (d ? d.replaceAll('-', '') : '');

/** The data row columns, in order. Change only together with the bureau's specification. */
export const BUREAU_COLUMNS: ReadonlyArray<{
  name: string;
  help: string;
  value: (r: BureauLoanRecord) => string;
}> = [
  { name: 'RecordType', help: 'Always D', value: () => 'D' },
  {
    name: 'CustomerType',
    help: 'I individual, C company',
    value: (r) => (r.borrowerType === 'BUSINESS' ? 'C' : 'I'),
  },
  { name: 'CustomerNumber', help: 'Lender’s customer number', value: (r) => r.customerNumber },
  { name: 'Name', help: 'Full or registered name', value: (r) => r.name },
  { name: 'NationalId', help: '16 digits, individuals', value: (r) => r.nationalId ?? '' },
  {
    name: 'RegistrationNumber',
    help: 'RDB company code, companies',
    value: (r) => r.registrationNumber ?? '',
  },
  { name: 'DateOfBirth', help: 'YYYYMMDD', value: (r) => ymd(r.dateOfBirth) },
  {
    name: 'Gender',
    help: 'F, M or U',
    value: (r) => (r.borrowerType === 'BUSINESS' ? '' : GENDER_CODE[r.gender ?? 'UNDISCLOSED']),
  },
  { name: 'Phone', help: 'E.164', value: (r) => r.phone },
  { name: 'District', help: 'Rwandan district', value: (r) => r.district ?? '' },
  { name: 'AccountNumber', help: 'Loan reference', value: (r) => r.accountNumber },
  { name: 'Product', help: 'Product name', value: (r) => r.productName },
  { name: 'Currency', help: 'Always RWF', value: () => 'RWF' },
  { name: 'DateOpened', help: 'Disbursement date, YYYYMMDD', value: (r) => ymd(r.dateOpened) },
  { name: 'MaturityDate', help: 'YYYYMMDD', value: (r) => ymd(r.maturityDate) },
  { name: 'TermMonths', help: 'Whole months', value: (r) => String(r.termMonths) },
  { name: 'Principal', help: 'Amount lent, whole RWF', value: (r) => r.principal.toString() },
  {
    name: 'InstalmentAmount',
    help: 'Regular instalment, whole RWF',
    value: (r) => r.instalmentAmount.toString(),
  },
  {
    name: 'CurrentBalance',
    help: 'Owed at period end, whole RWF',
    value: (r) => r.currentBalance.toString(),
  },
  {
    name: 'ArrearsAmount',
    help: 'Overdue at period end, whole RWF',
    value: (r) => r.arrearsAmount.toString(),
  },
  { name: 'DaysInArrears', help: 'Days', value: (r) => String(r.daysInArrears) },
  {
    name: 'Classification',
    help: 'BNR class: N, W, S, D or L',
    value: (r) => CLASS_CODE[r.creditClass],
  },
  {
    name: 'AccountStatus',
    help: 'A active, C closed, W written off',
    value: (r) => STATUS_CODE[r.status],
  },
  { name: 'ClosedDate', help: 'YYYYMMDD', value: (r) => ymd(r.closedOn) },
  { name: 'WrittenOffDate', help: 'YYYYMMDD', value: (r) => ymd(r.writtenOffOn) },
  {
    name: 'WrittenOffAmount',
    help: 'Whole RWF',
    value: (r) => (r.writtenOffAmount > 0n ? r.writtenOffAmount.toString() : ''),
  },
  { name: 'LastPaymentDate', help: 'YYYYMMDD', value: (r) => ymd(r.lastPaymentDate) },
  {
    name: 'LastPaymentAmount',
    help: 'Whole RWF',
    value: (r) => (r.lastPaymentAmount > 0n ? r.lastPaymentAmount.toString() : ''),
  },
  { name: 'CollateralType', help: 'Main security', value: (r) => r.collateralType ?? '' },
  {
    name: 'CollateralValue',
    help: 'Whole RWF',
    value: (r) => (r.collateralValue > 0n ? r.collateralValue.toString() : ''),
  },
  { name: 'Guarantors', help: 'Number of guarantors', value: (r) => String(r.guarantorCount) },
];

/** Field text safe for a pipe-delimited line: no pipes, no line breaks, trimmed. */
export function bureauField(value: string): string {
  return value
    .replace(/[|\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export interface BureauProblem {
  accountNumber: string;
  field: string;
  message: string;
}

/**
 * Problems that stop a record from being reported: the bureau matches people
 * by their identifier, so a loan without one would be rejected or, worse,
 * matched to the wrong person.
 */
export function bureauProblems(r: BureauLoanRecord): BureauProblem[] {
  const out: BureauProblem[] = [];
  const add = (field: string, message: string) =>
    out.push({ accountNumber: r.accountNumber, field, message });
  if (r.borrowerType === 'INDIVIDUAL') {
    if (!r.nationalId) add('NationalId', 'No national ID on file');
    else if (!/^[12]\d{15}$/.test(r.nationalId))
      add('NationalId', 'National ID is not 16 digits starting with 1 or 2');
  } else if (!r.registrationNumber) {
    add('RegistrationNumber', 'No RDB company code on file');
  }
  if (!bureauField(r.name)) add('Name', 'No name');
  if (!/^\+2507\d{8}$/.test(r.phone)) add('Phone', 'Phone is not a Rwandan mobile number');
  if (r.currentBalance < 0n) add('CurrentBalance', 'Balance is negative');
  return out;
}

export interface BureauFile {
  content: string;
  recordCount: number;
  totalBalance: Rwf;
  totalArrears: Rwf;
  excluded: BureauProblem[];
}

/** Build the monthly file. Records with problems are left out and listed instead. */
export function buildBureauFile(header: BureauHeader, records: BureauLoanRecord[]): BureauFile {
  const lines: string[] = [];
  const excluded: BureauProblem[] = [];
  let totalBalance = 0n;
  let totalArrears = 0n;
  lines.push(
    [
      'H',
      bureauField(header.lenderCode),
      bureauField(header.lenderName),
      ymd(header.periodEnd),
      ymd(header.createdOn),
      BUREAU_FORMAT_VERSION,
    ].join('|'),
  );
  lines.push(['C', ...BUREAU_COLUMNS.map((c) => c.name)].join('|'));
  for (const r of [...records].sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))) {
    const problems = bureauProblems(r);
    if (problems.length) {
      excluded.push(...problems);
      continue;
    }
    lines.push(BUREAU_COLUMNS.map((c) => bureauField(c.value(r))).join('|'));
    totalBalance += r.currentBalance;
    totalArrears += r.arrearsAmount;
  }
  const recordCount = lines.length - 2;
  lines.push(
    ['T', String(recordCount), totalBalance.toString(), totalArrears.toString()].join('|'),
  );
  return {
    content: `${lines.join('\r\n')}\r\n`,
    recordCount,
    totalBalance,
    totalArrears,
    excluded,
  };
}

/** "2026-10" → its first and last day. */
export function bureauPeriod(month: string): { start: IsoDate; end: IsoDate } {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw new RangeError(`Not a month: "${month}"`);
  const start = `${m[1]}-${m[2]}-01`;
  const next =
    m[2] === '12'
      ? `${Number(m[1]) + 1}-01-01`
      : `${m[1]}-${String(Number(m[2]) + 1).padStart(2, '0')}-01`;
  return { start, end: addDays(next, -1) };
}

/**
 * Arrears at the end of a past day from the schedule and what had been paid by
 * then (an instalment due that day is not yet late, as in collections):
 * payments settle the oldest instalments first, so whatever fell due before
 * `asOf` and not covered is in arrears, dated from the oldest uncovered due
 * date.
 */
export function arrearsAt(
  instalments: ReadonlyArray<{ dueDate: IsoDate; amount: Rwf }>,
  paidByThen: Rwf,
  asOf: IsoDate,
): { arrearsAmount: Rwf; daysInArrears: number } {
  let covered = paidByThen;
  let arrears = 0n;
  let oldest: IsoDate | null = null;
  for (const inst of [...instalments].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    const short = inst.amount - (covered > inst.amount ? inst.amount : covered);
    covered = covered > inst.amount ? covered - inst.amount : 0n;
    if (inst.dueDate >= asOf) break;
    if (short > 0n) {
      arrears += short;
      oldest ??= inst.dueDate;
    }
  }
  const days = oldest
    ? Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / 86_400_000)
    : 0;
  return { arrearsAmount: arrears, daysInArrears: days };
}
