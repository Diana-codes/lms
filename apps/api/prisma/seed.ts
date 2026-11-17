/**
 * Development seed. Rebuilds the database with the sample data shown in the
 * approved designs (design/screens), plus generated filler so that portfolio
 * totals land where the designs put them: 1,142 active loans, about
 * RWF 2.48B outstanding, and 1,021 / 84 / 25 / 12 loans across the DPD buckets.
 *
 * The designs are dated 12 Nov 2026. By default every date is shifted so the
 * data is "as of today", which keeps days-past-due correct whenever you seed.
 * Set SEED_DATE=2026-11-12 to reproduce the design dates exactly.
 *
 * Everything is deterministic: the same SEED_DATE gives the same data.
 * All people, phone numbers and ID numbers here are made up.
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  addDays,
  addMonths,
  buildSchedule,
  daysBetween,
  daysPastDue,
  dpdBucket,
  formatRwf,
  formatRwfCompact,
  isoToUtcDate,
  type IsoDate,
  kigaliDate,
  type Schedule,
} from '@kora/core';
import { hashPassword, MIN_PASSWORD_LENGTH } from '../src/auth/password';
import { PiiCrypto } from '../src/common/pii-crypto';
import { loadEnv } from '../src/config/env';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';
import type {
  ApplicationStage,
  CollectionAction,
  ContactChannel,
  ContactOutcome,
  KycDocumentType,
  PaymentChannel,
  ProductKind,
  ScoreRecommendation,
} from '../src/generated/prisma/client';
import { ACCOUNTS, type AccountKey, CHANNEL_ACCOUNT } from '../src/ledger/accounts';
import {
  balancedLines,
  disbursementLines,
  type PostingLine,
  repaymentLines,
} from '../src/ledger/posting';
import { sampleIdCardPng, samplePdf } from './sample-files';

const env = loadEnv();
if (env.NODE_ENV === 'production') {
  throw new Error('The development seed wipes the database. It will not run in production.');
}
const staffPassword = process.env.SEED_STAFF_PASSWORD ?? '';
if (staffPassword.length < MIN_PASSWORD_LENGTH) {
  throw new Error(
    `Set SEED_STAFF_PASSWORD (at least ${MIN_PASSWORD_LENGTH} characters) in apps/api/.env, or run \`pnpm setup:env\`.`,
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
const crypto = new PiiCrypto(env.PII_ENCRYPTION_KEY, env.PII_HASH_KEY);

// ── time ────────────────────────────────────────────────────────────────

const DESIGN_DATE: IsoDate = '2026-11-12';
const TODAY: IsoDate = process.env.SEED_DATE ?? kigaliDate();
const SHIFT = daysBetween(DESIGN_DATE, TODAY);

/** A date as written in the designs, moved to the seeded "today". */
const d = (designDate: IsoDate): IsoDate => addDays(designDate, SHIFT);
const date = (iso: IsoDate): Date => isoToUtcDate(iso);
/** An instant on a Kigali calendar day (UTC+2). */
const at = (iso: IsoDate, hour = 10, minute = 0): Date =>
  new Date(isoToUtcDate(iso).getTime() + ((hour - 2) * 60 + minute) * 60_000);
const NOW = at(TODAY, 11, 30);
const hoursAgo = (h: number): Date => new Date(NOW.getTime() - h * 3_600_000);

// ── deterministic randomness ────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const rand = mulberry32(20261112);
const int = (min: number, max: number): number => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
function weighted<T>(options: ReadonlyArray<readonly [T, number]>): T {
  const total = options.reduce((sum, [, w]) => sum + w, 0);
  let roll = rand() * total;
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return options[options.length - 1]![0];
}
function uuid(): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16));
  hex[12] = '4';
  hex[16] = '89ab'[Math.floor(rand() * 4)]!;
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// ── reference data ──────────────────────────────────────────────────────

type OfficerKey = 'KN' | 'JM' | 'AM' | 'DR';

const STAFF = [
  { key: 'ADMIN', email: 'admin@koralend.test', first: 'Alice', last: 'Uwimana', role: 'ADMIN' },
  { key: 'MGR', email: 'manager@koralend.test', first: 'Claire', last: 'Mutesi', role: 'MANAGER' },
  {
    key: 'KN',
    email: 'kevin@koralend.test',
    first: 'Kevin',
    last: 'Nkurunziza',
    role: 'LOAN_OFFICER',
  },
  {
    key: 'JM',
    email: 'jeanne@koralend.test',
    first: 'Jeanne',
    last: 'Mukamana',
    role: 'LOAN_OFFICER',
  },
  {
    key: 'AM',
    email: 'aimable@koralend.test',
    first: 'Aimable',
    last: 'Munyaneza',
    role: 'LOAN_OFFICER',
  },
  {
    key: 'DR',
    email: 'diane@koralend.test',
    first: 'Diane',
    last: 'Rutayisire',
    role: 'LOAN_OFFICER',
  },
  {
    key: 'COL',
    email: 'collections@koralend.test',
    first: 'Eric',
    last: 'Bizimana',
    role: 'COLLECTIONS_AGENT',
  },
] as const;

type ProductCode = 'SME-WC' | 'PERSONAL' | 'SALARY' | 'AGRI' | 'ASSET';

interface ProductSeed {
  code: ProductCode;
  name: string;
  shortName: string;
  kind: ProductKind;
  rateBps: number;
  terms: number[];
  min: bigint;
  max: bigint;
  autoScore: number | null;
  autoMax: bigint | null;
  secondAbove: bigint;
  /** Typical principal in thousands of RWF, before scaling to the design totals. */
  typical: [number, number];
  /** Share of loans by count, and share of the outstanding portfolio (Reports design). */
  countWeight: number;
  portfolioShare: number;
}

const PRODUCTS: ProductSeed[] = [
  {
    code: 'SME-WC',
    name: 'SME working capital',
    shortName: 'SME',
    kind: 'SME',
    rateBps: 1700,
    terms: [12, 18, 24, 36],
    min: 500_000n,
    max: 50_000_000n,
    autoScore: 730,
    autoMax: 10_000_000n,
    secondAbove: 10_000_000n,
    typical: [1500, 9000],
    countWeight: 23,
    portfolioShare: 38,
  },
  {
    code: 'ASSET',
    name: 'Asset finance',
    shortName: 'Asset finance',
    kind: 'ASSET',
    rateBps: 1600,
    terms: [24, 36, 48],
    min: 1_000_000n,
    max: 100_000_000n,
    autoScore: null,
    autoMax: null,
    secondAbove: 10_000_000n,
    typical: [4000, 16000],
    countWeight: 7,
    portfolioShare: 24,
  },
  {
    code: 'AGRI',
    name: 'Agri input loan',
    shortName: 'Agri input',
    kind: 'AGRI',
    rateBps: 1500,
    terms: [6, 9, 12, 18],
    min: 200_000n,
    max: 20_000_000n,
    autoScore: 720,
    autoMax: 3_000_000n,
    secondAbove: 8_000_000n,
    typical: [800, 5000],
    countWeight: 17,
    portfolioShare: 17,
  },
  {
    code: 'PERSONAL',
    name: 'Personal loan',
    shortName: 'Personal',
    kind: 'PERSONAL',
    rateBps: 2000,
    terms: [6, 12, 18, 24],
    min: 100_000n,
    max: 5_000_000n,
    autoScore: 740,
    autoMax: 1_500_000n,
    secondAbove: 4_000_000n,
    typical: [400, 3000],
    countWeight: 21,
    portfolioShare: 13,
  },
  {
    code: 'SALARY',
    name: 'Salary advance',
    shortName: 'Salary advance',
    kind: 'PERSONAL',
    rateBps: 1200,
    terms: [3, 4, 6],
    min: 50_000n,
    max: 2_000_000n,
    autoScore: 700,
    autoMax: 1_000_000n,
    secondAbove: 2_000_000n,
    typical: [150, 1200],
    countWeight: 32,
    portfolioShare: 8,
  },
];
const productByCode = new Map(PRODUCTS.map((p) => [p.code, p]));

/** Targets from the Overview and Reports designs. */
const TARGET = {
  activeLoans: 1142,
  outstanding: 2_480_000_000n,
  buckets: { CURRENT: 1021, DPD_1_30: 84, DPD_31_90: 25, DPD_90_PLUS: 12 },
  officerLoans: { KN: 312, JM: 288, AM: 274, DR: 268 } as Record<OfficerKey, number>,
};

const FIRST_NAMES = [
  'Aimée',
  'Alain',
  'Alice',
  'Angelique',
  'Assumpta',
  'Benjamin',
  'Béatrice',
  'Callixte',
  'Cedric',
  'Chantal',
  'Christian',
  'Clarisse',
  'Damascène',
  'Delphine',
  'Denise',
  'Désiré',
  'Dieudonné',
  'Egide',
  'Emery',
  'Espérance',
  'Eugène',
  'Fidèle',
  'Florence',
  'Francine',
  'Gilbert',
  'Gloria',
  'Honorine',
  'Ignace',
  'Immaculée',
  'Innocent',
  'Jacqueline',
  'Janvier',
  'Joselyne',
  'Josiane',
  'Juvénal',
  'Laetitia',
  'Léonce',
  'Liliane',
  'Marcel',
  'Marie-Claire',
  'Médiatrice',
  'Naomie',
  'Nadia',
  'Olive',
  'Pacifique',
  'Pascal',
  'Pauline',
  'Prosper',
  'Régine',
  'Richard',
  'Sylvie',
  'Théogène',
  'Thierry',
  'Valentine',
  'Vestine',
  'Vincent',
  'Yvette',
  'Yvonne',
  'Zacharie',
];
const LAST_NAMES = [
  'Bizimungu',
  'Gakwaya',
  'Gasana',
  'Habyarimana',
  'Hategekimana',
  'Kabera',
  'Kagabo',
  'Kamanzi',
  'Karangwa',
  'Karekezi',
  'Kayiranga',
  'Manirakiza',
  'Mbonigaba',
  'Mukandayisenga',
  'Mukashyaka',
  'Munyakazi',
  'Murekatete',
  'Musabyimana',
  'Mutoni',
  'Ndahimana',
  'Ngabo',
  'Niyibizi',
  'Niyitegeka',
  'Nkusi',
  'Nsabimana',
  'Ntaganda',
  'Nyirahabimana',
  'Rugamba',
  'Rukundo',
  'Rwigema',
  'Sebahire',
  'Sibomana',
  'Twagiramungu',
  'Uwamahoro',
  'Uwineza',
  'Uwizeye',
];
const BUSINESS_WORDS = [
  'Akagera',
  'Amahoro',
  'Gisozi',
  'Ikaze',
  'Imena',
  'Inzozi',
  'Isange',
  'Kivu',
  'Muhazi',
  'Nyungwe',
  'Rebero',
  'Sabyinyo',
  'Umucyo',
  'Urugwiro',
  'Virunga',
];
const BUSINESS_KINDS: Array<[string, string]> = [
  ['Traders Ltd', 'Retail & wholesale'],
  ['Hardware Ltd', 'Construction supplies'],
  ['Farmers Coop', 'Agriculture'],
  ['Transport Ltd', 'Transport & logistics'],
  ['Agro Dealers', 'Agriculture'],
  ['Fashion House', 'Garments & tailoring'],
  ['Dairy Coop', 'Agriculture'],
  ['Motors Ltd', 'Transport & logistics'],
];
const DISTRICTS: Array<[string, string[]]> = [
  ['Gasabo', ['Kimironko', 'Remera', 'Kacyiru', 'Gisozi']],
  ['Kicukiro', ['Niboye', 'Kagarama', 'Gikondo']],
  ['Nyarugenge', ['Nyamirambo', 'Muhima', 'Kimisagara']],
  ['Musanze', ['Muhoza', 'Cyuve']],
  ['Rubavu', ['Gisenyi', 'Rugerero']],
  ['Huye', ['Ngoma', 'Tumba']],
  ['Rwamagana', ['Kigabiro', 'Muhazi']],
  ['Muhanga', ['Nyamabuye', 'Shyogwe']],
];

// ── collectors ──────────────────────────────────────────────────────────

const rows = {
  borrowers: [] as Prisma.BorrowerCreateManyInput[],
  businesses: [] as Prisma.BusinessCreateManyInput[],
  applications: [] as Prisma.ApplicationCreateManyInput[],
  scores: [] as Prisma.CreditScoreCreateManyInput[],
  loans: [] as Prisma.LoanCreateManyInput[],
  instalments: [] as Prisma.ScheduleInstalmentCreateManyInput[],
  ledgerTx: [] as Prisma.LedgerTransactionCreateManyInput[],
  ledgerEntries: [] as Prisma.LedgerEntryCreateManyInput[],
  payments: [] as Prisma.PaymentCreateManyInput[],
  disbursements: [] as Prisma.DisbursementCreateManyInput[],
  cases: [] as Prisma.CollectionCaseCreateManyInput[],
  contacts: [] as Prisma.ContactLogCreateManyInput[],
  promises: [] as Prisma.PromiseToPayCreateManyInput[],
  sms: [] as Prisma.SmsMessageCreateManyInput[],
  notes: [] as Prisma.NoteCreateManyInput[],
  kyc: [] as Prisma.KycDocumentCreateManyInput[],
  consents: [] as Prisma.ConsentCreateManyInput[],
  notifications: [] as Prisma.NotificationCreateManyInput[],
  inflows: [] as Prisma.MomoInflowMonthCreateManyInput[],
};

const ids = {
  staff: new Map<string, string>(),
  product: new Map<ProductCode, string>(),
  account: new Map<AccountKey, string>(),
  branch: '',
};
const officerId = (key: OfficerKey): string => ids.staff.get(key)!;

// ── borrowers ───────────────────────────────────────────────────────────

const usedPhones = new Set<string>();
/** A made-up Rwandan mobile number. `shape` pins the visible digits, e.g. "78", "412". */
function phone(prefix?: string, last3?: string): string {
  for (;;) {
    const p = prefix ?? pick(['78', '79', '72', '73']);
    const middle = String(int(0, 9999)).padStart(4, '0');
    const end = last3 ?? String(int(0, 999)).padStart(3, '0');
    const value = `+250${p}${middle}${end}`;
    if (!usedPhones.has(value)) {
      usedPhones.add(value);
      return value;
    }
  }
}

let nidCounter = 1000;
function nationalId(): { enc: string; hash: string; last3: string } {
  const year = int(1962, 2003);
  const gender = pick(['8', '7']);
  const serial = String(++nidCounter).padStart(7, '0');
  const value = `1${year}${gender}${serial}0${String(int(10, 99))}`;
  return { enc: crypto.encrypt(value), hash: crypto.lookupHash(value), last3: value.slice(-3) };
}

let borrowerSeq = 0;
const borrowerCode = (): string => {
  borrowerSeq += 1;
  if (borrowerSeq === 731) borrowerSeq += 1; // BR-00731 is Aline's, as in the designs
  return `BR-${String(borrowerSeq).padStart(5, '0')}`;
};

interface BorrowerOpts {
  name: string;
  officer: OfficerKey;
  code?: string;
  phone?: [string, string];
  business?: { name: string; sector: string; role?: string; revenue?: bigint };
  isBusiness?: boolean;
  income?: bigint;
  district?: string;
  sector?: string;
  since?: IsoDate;
  kyc?: 'VERIFIED' | 'PENDING';
  risk?: 'LOW' | 'MEDIUM' | 'HIGH';
  limit?: bigint;
  momo?: boolean;
}

function addBorrower(o: BorrowerOpts): string {
  const id = uuid();
  const [district, sectors] = pick(DISTRICTS);
  const nid = nationalId();
  rows.borrowers.push({
    id,
    code: o.code ?? borrowerCode(),
    type: o.isBusiness ? 'BUSINESS' : 'INDIVIDUAL',
    fullName: o.name,
    phone: o.phone ? phone(o.phone[0], o.phone[1]) : phone(),
    nationalIdEnc: nid.enc,
    nationalIdHash: nid.hash,
    nationalIdLast3: nid.last3,
    gender: o.isBusiness ? 'UNDISCLOSED' : pick(['FEMALE', 'MALE'] as const),
    district: o.district ?? district,
    sector: o.sector ?? pick(sectors),
    monthlyIncome: o.income ?? null,
    incomeVerifiedAt: o.income ? at(d('2026-04-15')) : null,
    momoLinked: o.momo ?? rand() < 0.85,
    kycStatus: o.kyc ?? 'VERIFIED',
    riskLevel: o.risk ?? null,
    preApprovedLimit: o.limit ?? null,
    officerId: officerId(o.officer),
    branchId: ids.branch,
    customerSince: date(o.since ?? addDays(TODAY, -int(30, 900))),
  });
  if (o.business) {
    rows.businesses.push({
      id: uuid(),
      borrowerId: id,
      name: o.business.name,
      sector: o.business.sector,
      borrowerRole: o.business.role ?? null,
      avgMonthlyRevenue: o.business.revenue ?? null,
    });
  }
  return id;
}

// ── loans, schedules and the ledger ─────────────────────────────────────

const usedLoanCodes = new Set<string>();
const loanSeqByYear = new Map<string, number>();
const RESERVED_LOAN_CODES = [
  'LN-0418-2026',
  'LN-0912-2025',
  'LN-0233-2024',
  'LN-0431-2026',
  'LN-0377-2026',
  'LN-0291-2026',
  'LN-0350-2026',
  'LN-0402-2026',
  'LN-0388-2026',
  'LN-0415-2026',
];
RESERVED_LOAN_CODES.forEach((c) => usedLoanCodes.add(c));
function loanCode(disbursedOn: IsoDate): string {
  const year = disbursedOn.slice(0, 4);
  for (;;) {
    const next = (loanSeqByYear.get(year) ?? 0) + 1;
    loanSeqByYear.set(year, next);
    const code = `LN-${String(next).padStart(4, '0')}-${year}`;
    if (!usedLoanCodes.has(code)) {
      usedLoanCodes.add(code);
      return code;
    }
  }
}

let externalRefCounter = 0;
const externalRef = (channel: PaymentChannel): string | null => {
  externalRefCounter += 1;
  if (channel === 'CASH') return null;
  const base = channel === 'BANK_TRANSFER' ? 'BK' : '';
  return `${base}${4_100_000_000 + externalRefCounter * 7}`;
};

function postLedger(opts: {
  type: Prisma.LedgerTransactionCreateManyInput['type'];
  key: string;
  loanId: string | null;
  on: IsoDate;
  postedAt: Date;
  memo: string;
  lines: PostingLine[];
  postedById?: string | null;
}): string {
  const id = uuid();
  if (opts.on < earliestPosting) earliestPosting = opts.on;
  rows.ledgerTx.push({
    id,
    type: opts.type,
    idempotencyKey: opts.key,
    loanId: opts.loanId,
    memo: opts.memo,
    effectiveOn: date(opts.on),
    postedAt: opts.postedAt,
    postedById: opts.postedById ?? null,
  });
  for (const line of balancedLines(opts.lines)) {
    rows.ledgerEntries.push({
      id: uuid(),
      transactionId: id,
      accountId: ids.account.get(line.account)!,
      // Only the loan's own accounts carry the loan id, so a loan's balance
      // is a simple sum over its entries on the receivable account.
      loanId: line.account === 'LOANS_PRINCIPAL' ? opts.loanId : null,
      direction: line.direction,
      amount: line.amount,
      createdAt: opts.postedAt,
    });
  }
  return id;
}

let totalDisbursed = 0n;
let earliestPosting: IsoDate = TODAY;

interface LoanOpts {
  borrowerId: string;
  product: ProductCode;
  principal: bigint;
  termMonths: number;
  rateBps?: number;
  firstDue: IsoDate;
  /** Instalments paid in full, counted from the first. */
  paid: number;
  officer: OfficerKey;
  code?: string;
  applicationId?: string;
  channel?: PaymentChannel;
  /** Days before the due date each instalment was paid (index 0 = instalment 1). */
  paidEarlyDays?: Record<number, number>;
  /** Exact payment time for specific instalments. */
  paidAt?: Record<number, Date>;
  /** A part-payment against the first unpaid instalment. */
  partial?: { amount: bigint; on: IsoDate };
  disbursedBy?: OfficerKey;
  collateral?: string;
}

interface SeededLoan {
  id: string;
  code: string;
  borrowerId: string;
  schedule: Schedule;
  outstanding: bigint;
  dpd: number;
  product: ProductCode;
  officer: OfficerKey;
  active: boolean;
}

const seeded: SeededLoan[] = [];

function addLoan(o: LoanOpts): SeededLoan {
  const product = productByCode.get(o.product)!;
  const rateBps = o.rateBps ?? product.rateBps;
  const schedule = buildSchedule({
    principal: o.principal,
    annualRateBps: rateBps,
    termMonths: o.termMonths,
    firstDueDate: o.firstDue,
  });
  const id = uuid();
  const disbursedOn = addMonths(o.firstDue, -1);
  const code = o.code ?? loanCode(disbursedOn);
  const repaid = o.paid >= o.termMonths;
  const lastRow = schedule.rows[schedule.rows.length - 1]!;
  let lastPaidOn: IsoDate | null = null;

  totalDisbursed += o.principal;
  const disbursementTx = postLedger({
    type: 'DISBURSEMENT',
    key: `seed:disbursement:${code}`,
    loanId: id,
    on: disbursedOn,
    postedAt: at(disbursedOn, 14, int(0, 59)),
    memo: `Disbursement of ${code}`,
    lines: disbursementLines(o.principal, 'MOMO_FLOAT'),
    postedById: officerId(o.disbursedBy ?? o.officer),
  });
  rows.disbursements.push({
    id: uuid(),
    loanId: id,
    amount: o.principal,
    channel: 'MTN_MOMO',
    status: 'SUCCESSFUL',
    idempotencyKey: `seed:disbursement:${code}`,
    externalRef: externalRef('MTN_MOMO'),
    initiatedAt: at(disbursedOn, 14, 0),
    confirmedAt: at(disbursedOn, 14, 5),
    initiatedById: officerId(o.disbursedBy ?? o.officer),
    ledgerTransactionId: disbursementTx,
  });

  let outstanding = o.principal;
  for (const row of schedule.rows) {
    const isPaid = row.number <= o.paid;
    const isPartial = !isPaid && row.number === o.paid + 1 && o.partial != null;
    let principalPaid = 0n;
    let interestPaid = 0n;
    let paidAt: Date | null = null;

    if (isPaid || isPartial) {
      const channel: PaymentChannel =
        o.channel ??
        weighted([
          ['MTN_MOMO', 78],
          ['BANK_TRANSFER', 12],
          ['CASH', 8],
          ['AIRTEL_MONEY', 2],
        ] as const);
      let paidOn: IsoDate;
      if (isPartial) {
        // Interest is covered first, then principal.
        interestPaid = o.partial!.amount < row.interest ? o.partial!.amount : row.interest;
        principalPaid = o.partial!.amount - interestPaid;
        paidOn = o.partial!.on;
        paidAt = at(paidOn, int(8, 18), int(0, 59));
      } else {
        principalPaid = row.principal;
        interestPaid = row.interest;
        paidOn = addDays(row.dueDate, -(o.paidEarlyDays?.[row.number] ?? 0));
        paidAt = o.paidAt?.[row.number] ?? at(paidOn, int(7, 19), int(0, 59));
        lastPaidOn = paidOn;
      }
      outstanding -= principalPaid;
      const key = `seed:payment:${code}:${row.number}${isPartial ? ':part' : ''}`;
      const tx = postLedger({
        type: 'REPAYMENT',
        key,
        loanId: id,
        on: paidOn,
        postedAt: paidAt,
        memo: isPartial
          ? `Part payment towards instalment ${row.number}`
          : `Instalment ${row.number}`,
        lines: repaymentLines(principalPaid, interestPaid, CHANNEL_ACCOUNT[channel]),
      });
      rows.payments.push({
        id: uuid(),
        loanId: id,
        borrowerId: o.borrowerId,
        amount: principalPaid + interestPaid,
        channel,
        status: 'SUCCESSFUL',
        idempotencyKey: key,
        externalRef: externalRef(channel),
        initiatedAt: paidAt,
        confirmedAt: paidAt,
        recordedById: channel === 'CASH' ? officerId(o.officer) : null,
        ledgerTransactionId: tx,
      });
    }

    rows.instalments.push({
      id: uuid(),
      loanId: id,
      number: row.number,
      dueDate: date(row.dueDate),
      principalDue: row.principal,
      interestDue: row.interest,
      principalPaid,
      interestPaid,
      status: isPaid ? 'PAID' : isPartial ? 'PARTIAL' : 'PENDING',
      paidAt: isPaid ? paidAt : null,
    });
  }

  rows.loans.push({
    id,
    code,
    borrowerId: o.borrowerId,
    applicationId: o.applicationId ?? null,
    productId: ids.product.get(o.product)!,
    principal: o.principal,
    annualRateBps: rateBps,
    termMonths: o.termMonths,
    instalmentAmount: schedule.instalment,
    status: repaid ? 'REPAID' : 'ACTIVE',
    disbursedOn: date(disbursedOn),
    firstDueDate: date(o.firstDue),
    maturityDate: date(lastRow.dueDate),
    collateral: o.collateral ?? null,
    closedOn: repaid && lastPaidOn ? date(lastPaidOn) : null,
    officerId: officerId(o.officer),
    branchId: ids.branch,
    createdAt: at(disbursedOn, 9, 0),
  });

  const oldestUnpaid = schedule.rows[o.paid]?.dueDate ?? null;
  const loan: SeededLoan = {
    id,
    code,
    borrowerId: o.borrowerId,
    schedule,
    outstanding,
    dpd: daysPastDue(oldestUnpaid, TODAY),
    product: o.product,
    officer: o.officer,
    active: !repaid,
  };
  seeded.push(loan);
  return loan;
}

/**
 * Pick a principal whose level instalment comes out near `instalment`.
 * This only chooses a seed input; the schedule itself is integer maths.
 */
function principalForInstalment(instalment: number, rateBps: number, term: number): bigint {
  const r = rateBps / 10_000 / 12;
  const p = r === 0 ? instalment * term : (instalment * (1 - Math.pow(1 + r, -term))) / r;
  return BigInt(Math.round(p / 1000) * 1000);
}

/**
 * First due date such that instalment `paid + 1` falls due exactly on
 * `target`. Month-end clamping can make a round trip miss by a few days,
 * so nudge the number of paid instalments until it lands.
 */
function firstDueFor(
  target: IsoDate,
  paid: number,
  maxPaid: number,
): { firstDue: IsoDate; paid: number } {
  for (const delta of [0, 1, -1, 2, -2, 3, -3]) {
    const k = paid + delta;
    if (k < 0 || k > maxPaid) continue;
    const firstDue = addMonths(target, -k);
    if (addMonths(firstDue, k) === target) return { firstDue, paid: k };
  }
  return { firstDue: addMonths(target, -paid), paid };
}

// ── applications and scores ─────────────────────────────────────────────

function addScore(o: {
  borrowerId: string;
  applicationId?: string;
  value: number;
  recommendation?: ScoreRecommendation;
  headline?: string;
  why: string[];
  watch?: string[];
  probabilityBps?: number;
  summary?: string;
  createdAt: Date;
}): void {
  rows.scores.push({
    id: uuid(),
    borrowerId: o.borrowerId,
    applicationId: o.applicationId ?? null,
    value: o.value,
    recommendation: o.recommendation ?? null,
    headline: o.headline ?? null,
    repayProbabilityBps: o.probabilityBps ?? null,
    summary: o.summary ?? null,
    reasons: [
      ...o.why.map((text) => ({ kind: 'why', text })),
      ...(o.watch ?? []).map((text) => ({ kind: 'watch', text })),
    ],
    inputs: { source: 'seed', note: 'Sample data from the approved designs' },
    modelVersion: 'seed-sample-v0',
    createdAt: o.createdAt,
  });
}

interface AppOpts {
  code: string;
  borrowerId: string;
  product: ProductCode;
  amount: bigint;
  term: number;
  rateBps: number;
  stage: ApplicationStage;
  officer: OfficerKey;
  enteredHoursAgo: number;
  statusNote?: string;
  docs: [number, number];
  score: number;
  ai: [ScoreRecommendation, string, string, number?];
  statedIncome?: bigint;
  declineReason?: string;
}

function addApplication(o: AppOpts): string {
  const id = uuid();
  const entered = hoursAgo(o.enteredHoursAgo);
  const decided = ['APPROVED', 'DISBURSED', 'DECLINED'].includes(o.stage);
  rows.applications.push({
    id,
    code: o.code,
    borrowerId: o.borrowerId,
    productId: ids.product.get(o.product)!,
    amount: o.amount,
    termMonths: o.term,
    annualRateBps: o.rateBps,
    stage: o.stage,
    stageEnteredAt: entered,
    statusNote: o.statusNote ?? null,
    docsReceived: o.docs[0],
    docsRequired: o.docs[1],
    statedMonthlyIncome: o.statedIncome ?? null,
    officerId: officerId(o.officer),
    branchId: ids.branch,
    // Decisions are always attributed to a person.
    decidedById: decided ? officerId(o.officer) : null,
    decidedAt: decided ? entered : null,
    declineReason: o.declineReason ?? null,
    submittedAt: new Date(entered.getTime() - 26 * 3_600_000),
    createdAt: new Date(entered.getTime() - 26 * 3_600_000),
  });
  addScore({
    borrowerId: o.borrowerId,
    applicationId: id,
    value: o.score,
    recommendation: o.ai[0],
    headline: o.ai[1],
    why: [o.ai[2]],
    probabilityBps: o.ai[3],
    createdAt: new Date(entered.getTime() - 25 * 3_600_000),
  });
  return id;
}

// ── the data from the designs ───────────────────────────────────────────

function seedAline(): void {
  const id = addBorrower({
    name: 'Aline Uwase',
    code: 'BR-00731',
    officer: 'KN',
    phone: ['78', '412'],
    business: {
      name: 'Uwase Tailoring',
      sector: 'Garments & tailoring',
      role: 'Owner',
      revenue: 1_650_000n,
    },
    income: 1_650_000n,
    district: 'Gasabo',
    sector: 'Kimironko',
    since: d('2024-02-05'),
    risk: 'LOW',
    limit: 6_000_000n,
    momo: true,
  });
  const aline = rows.borrowers[rows.borrowers.length - 1]!;
  aline.gender = 'FEMALE';

  // Three loans, 24 instalments, never late, two paid early (Borrower design).
  addLoan({
    borrowerId: id,
    code: 'LN-0233-2024',
    product: 'PERSONAL',
    principal: 800_000n,
    termMonths: 6,
    firstDue: d('2024-03-12'),
    paid: 6,
    officer: 'KN',
    channel: 'MTN_MOMO',
    paidEarlyDays: { 5: 4 },
  });
  addLoan({
    borrowerId: id,
    code: 'LN-0912-2025',
    product: 'SME-WC',
    principal: 2_000_000n,
    termMonths: 12,
    firstDue: d('2025-04-10'),
    paid: 12,
    officer: 'KN',
    channel: 'MTN_MOMO',
    paidEarlyDays: { 8: 3, 12: 21 },
  });
  const loan = addLoan({
    borrowerId: id,
    code: 'LN-0418-2026',
    product: 'SME-WC',
    principal: 4_500_000n,
    termMonths: 18,
    firstDue: d('2026-06-04'),
    paid: 6,
    officer: 'KN',
    channel: 'MTN_MOMO',
    paidEarlyDays: { 5: 1 },
    paidAt: { 5: at(d('2026-10-03'), 17, 40), 6: at(d('2026-11-04'), 9, 12) },
    collateral: 'Equipment lien',
  });

  addScore({
    borrowerId: id,
    value: 742,
    headline: 'Low risk, and improving',
    summary:
      'Low risk, and improving. MoMo inflows have been steady at about RWF 1.6M a month for 14 months, with a rise every December–January from school-uniform orders. A top-up to RWF 6M over 18 months would cost about RWF 380,000 a month, 23% of her revenue, inside the 35% affordability limit.',
    why: ['24 on-time payments', 'Stable revenue'],
    watch: ['Proof of address expires 30 Nov'],
    createdAt: at(d('2026-11-02')),
  });
  addScore({
    borrowerId: id,
    value: 724,
    why: ['18 on-time payments'],
    createdAt: at(d('2026-05-02')),
  });

  const kevin = officerId('KN');
  const docs: Array<
    [
      Prisma.KycDocumentCreateManyInput['type'],
      'VERIFIED',
      string,
      IsoDate,
      IsoDate | null,
      string | null,
    ]
  > = [
    ['NATIONAL_ID', 'VERIFIED', 'Verified via NIDA', '2024-02-05', null, 'NIDA'],
    ['BUSINESS_REGISTRATION', 'VERIFIED', 'RDB certificate', '2025-03-10', null, 'RDB'],
    [
      'FINANCIAL_STATEMENTS',
      'VERIFIED',
      'Bank & MoMo statements, 6 months',
      '2026-04-14',
      null,
      null,
    ],
    ['PROOF_OF_ADDRESS', 'VERIFIED', 'Utility bill', '2025-11-30', '2026-11-30', null],
  ];
  for (const [type, status, note, uploaded, expires, via] of docs) {
    rows.kyc.push({
      id: uuid(),
      borrowerId: id,
      type,
      status,
      note,
      verifiedVia: via,
      storageKey: `seed/kyc/BR-00731/${type.toLowerCase()}.pdf`,
      uploadedAt: at(d(uploaded)),
      verifiedAt: at(d(uploaded), 15),
      expiresOn: expires ? date(d(expires)) : null,
      verifiedById: kevin,
    });
  }
  for (const type of ['TERMS', 'DATA_PROCESSING', 'MOMO_HISTORY', 'CREDIT_BUREAU'] as const) {
    rows.consents.push({
      id: uuid(),
      borrowerId: id,
      type,
      textVersion: '2026-01',
      channel: 'APP',
      grantedAt: at(d('2026-04-28')),
    });
  }
  rows.notes.push({
    id: uuid(),
    borrowerId: id,
    loanId: loan.id,
    authorId: kevin,
    body: 'Visited the shop on 28 Oct. Two new sewing machines bought with the current loan; school-uniform orders up for January.',
    createdAt: at(d('2026-10-28'), 16, 5),
  });
  rows.sms.push({
    id: uuid(),
    borrowerId: id,
    loanId: loan.id,
    toPhone: aline.phone,
    body: 'Kora Lend: your instalment of RWF 284,985 is due on 4 Nov. Pay with MoMo Pay [YOUR CODE].',
    template: 'reminder.due_soon',
    status: 'DELIVERED',
    providerMessageId: 'seed-sms-0001',
    createdAt: at(d('2026-11-01'), 8),
    sentAt: at(d('2026-11-01'), 8),
    deliveredAt: at(d('2026-11-01'), 8, 1),
  });

  // The pipeline also shows a new, approved application from Aline.
  addApplication({
    code: 'APP-20931',
    borrowerId: id,
    product: 'SME-WC',
    amount: 4_500_000n,
    term: 18,
    rateBps: 1700,
    stage: 'APPROVED',
    officer: 'KN',
    enteredHoursAgo: 20,
    statusNote: 'Contract sent',
    docs: [5, 5],
    score: 742,
    ai: ['APPROVE', 'Approved by officer', 'Matched AI recommendation'],
    statedIncome: 1_650_000n,
  });
}

function seedPipeline(): void {
  type Row = [
    string,
    string,
    OfficerKey,
    ProductCode,
    bigint,
    number,
    number,
    ApplicationStage,
    number,
    string | undefined,
    [number, number],
    number,
    AppOpts['ai'],
    Partial<BorrowerOpts>?,
  ];
  const apps: Row[] = [
    [
      'APP-20934',
      'Moses Tuyisenge',
      'DR',
      'SME-WC',
      3_000_000n,
      12,
      1800,
      'NEW',
      2,
      undefined,
      [2, 5],
      712,
      ['APPROVE', 'Approve · 92% likely to repay', 'Steady MoMo inflows for 14 months', 9200],
    ],
    [
      'APP-20933',
      'Sandrine Iradukunda',
      'KN',
      'PERSONAL',
      850_000n,
      6,
      2100,
      'NEW',
      5,
      undefined,
      [1, 4],
      668,
      ['REVIEW', 'Review · thin credit file', 'First loan; ask for a guarantor'],
    ],
    [
      'APP-20928',
      'Jean-Paul Mugisha',
      'DR',
      'ASSET',
      12_000_000n,
      36,
      1600,
      'UNDER_REVIEW',
      24,
      undefined,
      [5, 6],
      688,
      ['APPROVE', 'Approve · 86% likely to repay', 'Vehicle value covers 1.3× the loan', 8600],
    ],
    [
      'APP-20921',
      'Eric Niyonzima',
      'AM',
      'AGRI',
      1_850_000n,
      9,
      1500,
      'UNDER_REVIEW',
      48,
      undefined,
      [4, 4],
      701,
      ['APPROVE', 'Approve · 90% likely to repay', 'Repaid 2 seasonal loans on time', 9000],
    ],
    [
      'APP-20919',
      'Umurage Coffee Coop',
      'KN',
      'SME-WC',
      9_400_000n,
      24,
      1700,
      'UNDER_REVIEW',
      72,
      undefined,
      [6, 6],
      735,
      ['AUTO_APPROVE_ELIGIBLE', 'Auto-approve eligible', 'Co-op sales up 22% this year'],
      { isBusiness: true, business: { name: 'Umurage Coffee Coop', sector: 'Agriculture' } },
    ],
    [
      'APP-20925',
      'Grace Ingabire',
      'AM',
      'SALARY',
      600_000n,
      3,
      1200,
      'CREDIT_CHECK',
      30,
      'Awaiting CRB',
      [3, 4],
      715,
      ['APPROVE', 'Approve · 94% likely to repay', 'Salary paid on time 12 months running', 9400],
    ],
    [
      'APP-20914',
      'Bosco Hakizimana',
      'DR',
      'ASSET',
      7_800_000n,
      24,
      1600,
      'CREDIT_CHECK',
      96,
      undefined,
      [6, 6],
      645,
      ['FLAG', 'Flag · income mismatch', 'Stated revenue 2.4× MoMo inflows'],
    ],
    [
      'APP-20909',
      'Fabrice Nshimiyimana',
      'AM',
      'AGRI',
      2_100_000n,
      12,
      1500,
      'APPROVED',
      4,
      'Signed today',
      [4, 4],
      720,
      ['APPROVE', 'Approved by officer', 'Matched AI recommendation'],
    ],
    [
      'APP-20917',
      'Claudine Mukamana',
      'JM',
      'PERSONAL',
      2_200_000n,
      18,
      2000,
      'DECLINED',
      120,
      undefined,
      [4, 4],
      594,
      ['REVIEW', 'Review · affordability', 'Instalment would be 48% of verified income'],
    ],
  ];
  for (const [
    code,
    name,
    officer,
    product,
    amount,
    term,
    rateBps,
    stage,
    hours,
    statusNote,
    docs,
    score,
    ai,
    extra,
  ] of apps) {
    const borrowerId = addBorrower({
      name,
      officer,
      kyc: docs[0] === docs[1] ? 'VERIFIED' : 'PENDING',
      ...extra,
    });
    addApplication({
      code,
      borrowerId,
      product,
      amount,
      term,
      rateBps,
      stage,
      officer,
      enteredHoursAgo: hours,
      statusNote,
      docs,
      score,
      ai,
      declineReason:
        stage === 'DECLINED' ? 'Instalment above the 35% affordability limit' : undefined,
    });
  }

  // Divine's loan went out via MoMo; her first instalment is due on 1 Dec.
  const divine = addBorrower({ name: 'Divine Umutoni', officer: 'DR', momo: true });
  const divineApp = addApplication({
    code: 'APP-20902',
    borrowerId: divine,
    product: 'PERSONAL',
    amount: 1_500_000n,
    term: 18,
    rateBps: 2000,
    stage: 'DISBURSED',
    officer: 'DR',
    enteredHoursAgo: 11 * 24,
    statusNote: 'Sent via MoMo',
    docs: [4, 4],
    score: 731,
    ai: ['APPROVE', 'First instalment due 1 Dec', 'No early-warning signals'],
  });
  addLoan({
    borrowerId: divine,
    code: 'LN-0431-2026',
    applicationId: divineApp,
    product: 'PERSONAL',
    principal: 1_500_000n,
    termMonths: 18,
    firstDue: d('2026-12-01'),
    paid: 0,
    officer: 'DR',
  });

  // The board's column headers count more applications than it shows cards
  // for (6, 7, 4, 5 and 2). These fill each column to its count and total.
  const filler: Array<
    [ApplicationStage, ProductCode, bigint, number, OfficerKey, number, string?]
  > = [
    ['NEW', 'SME-WC', 4_200_000n, 18, 'AM', 7],
    ['NEW', 'AGRI', 2_650_000n, 12, 'JM', 9],
    ['NEW', 'PERSONAL', 1_900_000n, 12, 'KN', 16],
    ['NEW', 'SALARY', 1_600_000n, 6, 'DR', 21],
    ['UNDER_REVIEW', 'SME-WC', 3_500_000n, 12, 'JM', 30],
    ['UNDER_REVIEW', 'PERSONAL', 2_300_000n, 18, 'AM', 50],
    ['UNDER_REVIEW', 'AGRI', 1_450_000n, 9, 'DR', 60],
    ['UNDER_REVIEW', 'SALARY', 1_000_000n, 4, 'KN', 80],
    ['CREDIT_CHECK', 'SME-WC', 6_500_000n, 24, 'KN', 40, 'Awaiting CRB'],
    ['CREDIT_CHECK', 'ASSET', 4_000_000n, 24, 'JM', 55, 'Awaiting CRB'],
    ['APPROVED', 'SME-WC', 5_000_000n, 18, 'DR', 26, 'Contract sent'],
    ['APPROVED', 'AGRI', 2_500_000n, 12, 'JM', 44, 'Contract sent'],
    ['APPROVED', 'PERSONAL', 1_500_000n, 12, 'AM', 50, 'Signed'],
  ];
  let seq = 20897; // below every application code used in the designs
  for (const [stage, product, amount, term, officer, hours, statusNote] of filler) {
    const score = int(655, 748);
    const borrowerId = addBorrower({ name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`, officer });
    const settled = stage === 'APPROVED';
    addApplication({
      code: `APP-${(seq -= 1)}`,
      borrowerId,
      product,
      amount,
      term,
      rateBps: productByCode.get(product)!.rateBps,
      stage,
      officer,
      enteredHoursAgo: hours,
      statusNote,
      docs: settled ? [4, 4] : [int(2, 4), 4],
      score,
      ai: settled
        ? ['APPROVE', 'Approved by officer', 'Matched AI recommendation']
        : score >= 700
          ? [
              'APPROVE',
              `Approve · ${80 + Math.floor((score - 655) / 6)}% likely to repay`,
              'Regular MoMo inflows',
              8000 + Math.floor((score - 655) / 6) * 100,
            ]
          : ['REVIEW', 'Review · limited history', 'Less than 6 months of MoMo history'],
    });
  }
  const other = addBorrower({
    name: 'Honorine Kamanzi',
    officer: 'KN',
    business: { name: 'Kamanzi Hardware', sector: 'Construction supplies', role: 'Owner' },
  });
  const otherApp = addApplication({
    code: 'APP-20897',
    borrowerId: other,
    product: 'SME-WC',
    amount: 4_700_000n,
    term: 24,
    rateBps: 1700,
    stage: 'DISBURSED',
    officer: 'KN',
    enteredHoursAgo: 15 * 24,
    statusNote: 'Sent via MoMo',
    docs: [5, 5],
    score: 726,
    ai: ['APPROVE', 'First instalment due soon', 'No early-warning signals'],
  });
  addLoan({
    borrowerId: other,
    applicationId: otherApp,
    product: 'SME-WC',
    principal: 4_700_000n,
    termMonths: 24,
    firstDue: addDays(TODAY, 15),
    paid: 0,
    officer: 'KN',
  });
}

function seedDueThisWeek(): void {
  // Overview design: "Due this week".
  const due: Array<
    [string, OfficerKey, ProductCode, number, number, number, IsoDate, Partial<BorrowerOpts>?]
  > = [
    ['Patrick Habimana', 'KN', 'PERSONAL', 186_400, 12, 5, '2026-11-12'],
    [
      'Kalisa Trading Ltd',
      'AM',
      'SME-WC',
      1_240_000,
      24,
      8,
      '2026-11-14',
      { isBusiness: true, business: { name: 'Kalisa Trading Ltd', sector: 'Retail & wholesale' } },
    ],
    ['Olivier Ndayisaba', 'JM', 'SALARY', 64_300, 6, 5, '2026-11-16'],
  ];
  for (const [name, officer, product, instalment, term, paid, nextDue, extra] of due) {
    const borrowerId = addBorrower({ name, officer, momo: true, ...extra });
    const target = d(nextDue);
    const fit = firstDueFor(target, paid, term - 1);
    addLoan({
      borrowerId,
      product,
      officer,
      termMonths: term,
      paid: fit.paid,
      firstDue: fit.firstDue,
      principal: principalForInstalment(instalment, productByCode.get(product)!.rateBps, term),
    });
  }
}

function seedCollections(): void {
  type Log = [ContactChannel, ContactOutcome, string, IsoDate, OfficerKey | null];
  interface Case {
    name: string;
    code: string;
    phone: [string, string];
    days: number;
    instalment: number;
    outstanding: number;
    product: ProductCode;
    officer: OfficerKey;
    next: CollectionAction;
    status: 'OPEN' | 'PROMISED';
    logs: Log[];
    promise?: [bigint, IsoDate, OfficerKey];
    partial?: { amount: bigint; on: IsoDate };
    business?: BorrowerOpts['business'];
  }
  const cases: Case[] = [
    {
      name: 'Emmanuel Mutabazi',
      code: 'LN-0377-2026',
      phone: ['72', '118'],
      days: 104,
      instalment: 153_100,
      outstanding: 1_980_000,
      product: 'PERSONAL',
      officer: 'JM',
      next: 'FIELD_VISIT',
      status: 'OPEN',
      logs: [
        ['CALL', 'NO_ANSWER', 'Call — no answer', '2026-11-10', 'JM'],
        ['LETTER', 'SENT', 'Demand letter sent', '2026-11-01', null],
      ],
    },
    {
      name: 'Solange Kayitesi',
      code: 'LN-0291-2026',
      phone: ['78', '507'],
      days: 67,
      instalment: 82_700,
      outstanding: 920_500,
      product: 'PERSONAL',
      officer: 'JM',
      next: 'FOLLOW_UP',
      status: 'PROMISED',
      logs: [
        ['CALL', 'PROMISED_TO_PAY', 'Promised to pay RWF 248,000 on 20 Nov', '2026-11-11', 'JM'],
        ['SMS', 'SENT', 'SMS reminder sent', '2026-11-05', null],
      ],
      promise: [248_000n, '2026-11-20', 'JM'],
    },
    {
      name: 'Bosco Habineza',
      code: 'LN-0350-2026',
      phone: ['73', '864'],
      days: 41,
      instalment: 126_950,
      outstanding: 1_310_000,
      product: 'AGRI',
      officer: 'JM',
      next: 'CALL',
      status: 'OPEN',
      logs: [
        ['PAYMENT', 'PAID_PART', 'Paid RWF 80,000 via MoMo', '2026-11-06', null],
        ['CALL', 'REACHED', 'Call — says harvest sale due', '2026-11-03', 'JM'],
      ],
      partial: { amount: 80_000n, on: '2026-11-06' },
    },
    {
      name: 'Uwimana Nadine',
      code: 'LN-0402-2026',
      phone: ['78', '230'],
      days: 23,
      instalment: 96_300,
      outstanding: 640_000,
      product: 'PERSONAL',
      officer: 'JM',
      next: 'CALL',
      status: 'OPEN',
      logs: [['SMS', 'SENT', 'SMS reminder sent', '2026-11-11', null]],
    },
    {
      name: 'Twizere Rice Growers',
      code: 'LN-0388-2026',
      phone: ['79', '951'],
      days: 12,
      instalment: 455_000,
      outstanding: 5_400_000,
      product: 'AGRI',
      officer: 'KN',
      next: 'WAIT',
      status: 'PROMISED',
      logs: [['CALL', 'PROMISED_TO_PAY', 'Promised to pay on 15 Nov', '2026-11-09', 'KN']],
      promise: [455_000n, '2026-11-15', 'KN'],
      business: { name: 'Twizere Rice Growers', sector: 'Agriculture' },
    },
    {
      name: 'Jean Hakizimana',
      code: 'LN-0415-2026',
      phone: ['72', '664'],
      days: 5,
      instalment: 58_200,
      outstanding: 410_000,
      product: 'PERSONAL',
      officer: 'DR',
      next: 'SMS',
      status: 'OPEN',
      logs: [['SMS', 'SENT', 'SMS reminder sent', '2026-11-09', null]],
    },
  ];

  let smsSeq = 100;
  for (const c of cases) {
    const product = productByCode.get(c.product)!;
    const borrowerId = addBorrower({
      name: c.name,
      officer: c.officer,
      phone: c.phone,
      isBusiness: !!c.business,
      business: c.business,
      risk: c.days > 30 ? 'HIGH' : 'MEDIUM',
    });
    const borrower = rows.borrowers[rows.borrowers.length - 1]!;

    // Work out how many instalments are left for the outstanding balance in
    // the design, then place the first missed one exactly `days` ago.
    const r = product.rateBps / 10_000 / 12;
    const remaining = Math.max(
      2,
      Math.round(-Math.log(1 - (c.outstanding * r) / c.instalment) / Math.log(1 + r)),
    );
    const fit = firstDueFor(addDays(TODAY, -c.days), int(3, 6), 12);
    const term = remaining + fit.paid;
    const loan = addLoan({
      borrowerId,
      code: c.code,
      product: c.product,
      officer: c.officer,
      termMonths: term,
      paid: fit.paid,
      firstDue: fit.firstDue,
      principal: principalForInstalment(c.instalment, product.rateBps, term),
      partial: c.partial ? { amount: c.partial.amount, on: d(c.partial.on) } : undefined,
    });

    const caseId = uuid();
    rows.cases.push({
      id: caseId,
      loanId: loan.id,
      status: c.status,
      nextAction: c.next,
      assignedToId: officerId('JM'),
      dpdAtOpen: 1,
      openedAt: at(addDays(TODAY, -c.days + 1), 6),
    });
    for (const [channel, outcome, summary, on, staff] of c.logs) {
      rows.contacts.push({
        id: uuid(),
        caseId,
        loanId: loan.id,
        borrowerId,
        staffId: staff ? officerId(staff) : null,
        channel,
        outcome,
        summary,
        occurredAt: at(d(on), int(9, 16), int(0, 59)),
      });
      if (channel === 'SMS') {
        rows.sms.push({
          id: uuid(),
          borrowerId,
          loanId: loan.id,
          toPhone: borrower.phone,
          body: 'Kora Lend: your payment is overdue. Pay with MoMo Pay [YOUR CODE] or call us to talk about it.',
          template: 'reminder.overdue',
          status: 'DELIVERED',
          providerMessageId: `seed-sms-${String(++smsSeq).padStart(4, '0')}`,
          createdAt: at(d(on), 8),
          sentAt: at(d(on), 8),
          deliveredAt: at(d(on), 8, 1),
        });
      }
    }
    if (c.promise) {
      rows.promises.push({
        id: uuid(),
        caseId,
        loanId: loan.id,
        amount: c.promise[0],
        promisedFor: date(d(c.promise[1])),
        recordedById: officerId(c.promise[2]),
        createdAt: at(d(c.logs[0]![3]), 11),
      });
    }
  }
}

/**
 * Six months of MoMo money-in for borrowers with a wallet, and their consent
 * to share it (about three in four agree). A few borrowers who are up to date
 * see a sharp drop last month, so early warning has something to find.
 */
function seedMomoHistory(): void {
  const thisMonth = `${TODAY.slice(0, 7)}-01`;
  const currentLoans = new Set(
    seeded.filter((l) => l.active && l.dpd === 0).map((l) => l.borrowerId),
  );
  const consented = new Set(
    rows.consents.filter((c) => c.type === 'MOMO_HISTORY').map((c) => c.borrowerId),
  );
  for (const b of rows.borrowers) {
    if (!b.momoLinked || !b.id) continue;
    const business = rows.businesses.find((x) => x.borrowerId === b.id);
    const base = Number(
      b.monthlyIncome ?? business?.avgMonthlyRevenue ?? BigInt(int(400, 2500) * 1000),
    );
    const dropping = currentLoans.has(b.id) && rand() < 0.03;
    for (let m = 6; m >= 1; m--) {
      const wobble = 0.88 + rand() * 0.24;
      const factor = dropping && m === 1 ? 0.55 : wobble;
      rows.inflows.push({
        id: uuid(),
        borrowerId: b.id,
        month: date(addMonths(thisMonth, -m)),
        inflow: BigInt(Math.round((base * factor) / 1000) * 1000),
      });
    }
    if (!consented.has(b.id) && (dropping || rand() < 0.75)) {
      rows.consents.push({
        id: uuid(),
        borrowerId: b.id,
        type: 'MOMO_HISTORY',
        textVersion: '2026-01',
        channel: 'OFFICER',
        grantedAt: at(addDays(TODAY, -int(30, 400))),
      });
    }
  }
  // APP-20914 (the designs' flagged application): stated revenue 2.4× what MoMo shows.
  const bosco = rows.applications.find((a) => a.code === 'APP-20914');
  if (bosco?.borrowerId) {
    const boscoId = bosco.borrowerId;
    const months = rows.inflows.filter((i) => i.borrowerId === boscoId);
    const borrower = rows.borrowers.find((x) => x.id === boscoId)!;
    if (!months.length) {
      borrower.momoLinked = true;
      for (let m = 6; m >= 1; m--)
        rows.inflows.push({
          id: uuid(),
          borrowerId: boscoId,
          month: date(addMonths(thisMonth, -m)),
          inflow: 1_000_000n,
        });
    }
    const avg =
      rows.inflows
        .filter((i) => i.borrowerId === boscoId)
        .reduce((s, i) => s + BigInt(i.inflow), 0n) / 6n;
    bosco.statedMonthlyIncome = (avg * 24n) / 10n;
    if (!rows.consents.some((c) => c.borrowerId === boscoId && c.type === 'MOMO_HISTORY')) {
      rows.consents.push({
        id: uuid(),
        borrowerId: boscoId,
        type: 'MOMO_HISTORY',
        textVersion: '2026-01',
        channel: 'APP',
        grantedAt: at(addDays(TODAY, -5)),
      });
    }
  }
}

/** What each kind of product asks for (matches the documents migration). */
const REQUIRED_DOCS: Record<ProductKind, KycDocumentType[]> = {
  SME: ['NATIONAL_ID', 'SELFIE', 'BUSINESS_REGISTRATION', 'FINANCIAL_STATEMENTS'],
  ASSET: ['NATIONAL_ID', 'SELFIE', 'BUSINESS_REGISTRATION', 'FINANCIAL_STATEMENTS'],
  AGRI: ['NATIONAL_ID', 'SELFIE', 'PROOF_OF_ADDRESS'],
  PERSONAL: ['NATIONAL_ID', 'SELFIE', 'FINANCIAL_STATEMENTS'],
};

/**
 * APP-20934 (Moses Tuyisenge) has two documents waiting for an officer: an ID
 * photo and an RDB certificate. Real sample files are written to UPLOAD_DIR
 * so View, Verify and "Ask for a new one" all work in the console.
 */
async function seedDemoDocuments(): Promise<void> {
  const app = rows.applications.find((a) => a.code === 'APP-20934');
  if (!app?.borrowerId) return;
  const borrowerId = app.borrowerId;
  const name = rows.borrowers.find((b) => b.id === borrowerId)?.fullName ?? 'Sample Borrower';
  const files: Array<[KycDocumentType, string, string, Buffer]> = [
    ['NATIONAL_ID', 'id-sample.png', 'image/png', sampleIdCardPng()],
    [
      'BUSINESS_REGISTRATION',
      'business-registration-sample.pdf',
      'application/pdf',
      samplePdf([
        'SAMPLE - Certificate of Domestic Company Registration',
        `Company: ${name} Trading Ltd`,
        'Company code: 000000000 (sample)',
        'Registered: 14 March 2023, Kigali',
        'This is a made-up document for the Kora Lend development seed.',
      ]),
    ],
  ];
  const uploadRoot = path.resolve(env.UPLOAD_DIR);
  for (const [i, [type, file, mimeType, body]] of files.entries()) {
    const storageKey = `kyc/${borrowerId}/${file}`;
    await mkdir(path.join(uploadRoot, 'kyc', borrowerId), { recursive: true });
    await writeFile(path.join(uploadRoot, storageKey), body, { mode: 0o600 });
    rows.kyc.push({
      id: uuid(),
      borrowerId,
      type,
      status: 'PENDING',
      storageKey,
      mimeType,
      sizeBytes: body.length,
      applicationId: app.id,
      uploadedAt: hoursAgo(2 - i),
    });
  }
}

function seedNotifications(): void {
  // Each staff member gets their own copy, so reading one does not hide it from the others.
  for (const userId of ids.staff.values()) {
    rows.notifications.push(
      {
        id: uuid(),
        userId,
        kind: 'AI_FLAG',
        title: 'AI flagged APP-20914 for an income mismatch',
        href: '/applications?open=APP-20914',
        createdAt: new Date(NOW.getTime() - 12 * 60_000),
      },
      {
        id: uuid(),
        userId,
        kind: 'RISK',
        title: '12 loans moved into 31–90 days late',
        href: '/collections',
        createdAt: hoursAgo(1),
      },
      {
        id: uuid(),
        userId,
        kind: 'CONTRACT',
        title: 'Aline Uwase signed her contract',
        href: '/loans/LN-0418-2026',
        createdAt: at(TODAY, 9, 40),
      },
    );
  }
}

// ── generated filler ────────────────────────────────────────────────────

interface FillerPlan {
  product: ProductSeed;
  term: number;
  firstDue: IsoDate;
  paid: number;
  officer: OfficerKey;
  basePrincipal: number;
  name: string;
  business?: BorrowerOpts['business'];
}

function planFiller(bucket: keyof typeof TARGET.buckets, officer: OfficerKey): FillerPlan {
  const product = weighted(PRODUCTS.map((p) => [p, p.countWeight] as const));
  let term = pick(product.terms);
  let firstDue: IsoDate;
  let paid: number;

  if (bucket === 'CURRENT') {
    // Everything due so far is paid; the next instalment is still ahead.
    paid = int(0, term - 1);
    firstDue =
      paid === 0 ? addDays(TODAY, int(1, 28)) : addMonths(addDays(TODAY, -int(1, 27)), -(paid - 1));
  } else {
    const days =
      bucket === 'DPD_1_30' ? int(1, 30) : bucket === 'DPD_31_90' ? int(31, 90) : int(91, 240);
    if (term < 6) term = 6;
    const fit = firstDueFor(
      addDays(TODAY, -days),
      int(1, Math.max(1, Math.min(term - 2, 10))),
      term - 1,
    );
    paid = fit.paid;
    firstDue = fit.firstDue;
  }

  const isBusiness = product.kind !== 'PERSONAL' && rand() < 0.22;
  const kind = pick(BUSINESS_KINDS);
  const businessName = `${pick(BUSINESS_WORDS)} ${kind[0]}`;
  return {
    product,
    term,
    firstDue,
    paid,
    officer,
    basePrincipal: int(product.typical[0], product.typical[1]),
    name: isBusiness ? businessName : `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    business: isBusiness ? { name: businessName, sector: kind[1] } : undefined,
  };
}

function outstandingAfter(principal: bigint, plan: FillerPlan): bigint {
  const schedule = buildSchedule({
    principal,
    annualRateBps: plan.product.rateBps,
    termMonths: plan.term,
    firstDueDate: plan.firstDue,
  });
  return plan.paid === 0 ? principal : schedule.rows[plan.paid - 1]!.balanceAfter;
}

function seedFiller(): void {
  const active = seeded.filter((l) => l.active);
  const bucketsLeft = { ...TARGET.buckets };
  const officersLeft = { ...TARGET.officerLoans };
  const outstandingByProduct = new Map<ProductCode, bigint>();
  for (const loan of active) {
    bucketsLeft[dpdBucket(loan.dpd)] -= 1;
    officersLeft[loan.officer] -= 1;
    outstandingByProduct.set(
      loan.product,
      (outstandingByProduct.get(loan.product) ?? 0n) + loan.outstanding,
    );
  }

  const officerPool: OfficerKey[] = [];
  for (const key of Object.keys(officersLeft) as OfficerKey[]) {
    for (let i = 0; i < officersLeft[key]; i++) officerPool.push(key);
  }
  for (let i = officerPool.length - 1; i > 0; i--) {
    const j = int(0, i);
    [officerPool[i], officerPool[j]] = [officerPool[j]!, officerPool[i]!];
  }

  const plans: FillerPlan[] = [];
  for (const bucket of Object.keys(bucketsLeft) as Array<keyof typeof bucketsLeft>) {
    for (let i = 0; i < bucketsLeft[bucket]; i++)
      plans.push(planFiller(bucket, officerPool.pop()!));
  }

  // Scale each product's principals so its outstanding balance matches its
  // share of the RWF 2.48B portfolio in the Reports design.
  const raw = new Map<ProductCode, bigint>();
  for (const plan of plans) {
    const value = outstandingAfter(BigInt(plan.basePrincipal) * 1000n, plan);
    raw.set(plan.product.code, (raw.get(plan.product.code) ?? 0n) + value);
  }
  for (const plan of plans) {
    const code = plan.product.code;
    const target =
      (TARGET.outstanding * BigInt(plan.product.portfolioShare)) / 100n -
      (outstandingByProduct.get(code) ?? 0n);
    let principal = (BigInt(plan.basePrincipal) * 1000n * target) / raw.get(code)!;
    principal = (principal / 10_000n) * 10_000n;
    if (principal < plan.product.min) principal = plan.product.min;
    if (principal > plan.product.max) principal = plan.product.max;

    const borrowerId = addBorrower({
      name: plan.name,
      officer: plan.officer,
      isBusiness: !!plan.business,
      business: plan.business,
      income: principal / BigInt(int(2, 5)),
    });
    addLoan({
      borrowerId,
      product: code,
      principal,
      termMonths: plan.term,
      firstDue: plan.firstDue,
      paid: plan.paid,
      officer: plan.officer,
    });
  }
}

// ── write ───────────────────────────────────────────────────────────────

async function insertMany<T>(
  label: string,
  items: T[],
  insert: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < items.length; i += 2000) await insert(items.slice(i, i + 2000));
  console.log(`  ${label.padEnd(22)} ${items.length.toLocaleString('en-US')}`);
}

async function main(): Promise<void> {
  console.log(
    `Seeding Kora Lend as of ${TODAY}${SHIFT ? ` (designs shifted by ${SHIFT} days)` : ''}\n`,
  );

  // TRUNCATE is the one way to clear the append-only tables, and only this
  // development script does it.
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );

  ids.branch = uuid();
  await prisma.branch.create({
    data: { id: ids.branch, code: 'KGL-01', name: 'Kigali – Kimironko', district: 'Gasabo' },
  });

  const passwordHash = await hashPassword(staffPassword);
  for (const s of STAFF) {
    const id = uuid();
    ids.staff.set(s.key, id);
    await prisma.user.create({
      data: {
        id,
        email: s.email,
        passwordHash,
        firstName: s.first,
        lastName: s.last,
        role: s.role,
        branchId: ids.branch,
        phone: phone('78'),
      },
    });
  }

  for (const p of PRODUCTS) {
    const id = uuid();
    ids.product.set(p.code, id);
    await prisma.product.create({
      data: {
        id,
        code: p.code,
        name: p.name,
        shortName: p.shortName,
        kind: p.kind,
        annualRateBps: p.rateBps,
        minTermMonths: Math.min(...p.terms),
        maxTermMonths: Math.max(...p.terms),
        minAmount: p.min,
        maxAmount: p.max,
        originationFeeBps: 150,
        latePenaltyBps: 200,
        autoApproveMinScore: p.autoScore,
        autoApproveMaxAmount: p.autoMax,
        secondApprovalAbove: p.secondAbove,
        requiredDocuments: REQUIRED_DOCS[p.kind],
      },
    });
  }

  for (const key of Object.keys(ACCOUNTS) as AccountKey[]) {
    const id = uuid();
    ids.account.set(key, id);
    await prisma.ledgerAccount.create({ data: { id, ...ACCOUNTS[key] } });
  }

  seedAline();
  seedPipeline();
  seedDueThisWeek();
  seedCollections();
  seedNotifications();
  seedFiller();
  seedMomoHistory();
  await seedDemoDocuments();

  // Capital paid in before the first loan went out: enough float to cover
  // every disbursement, plus a reserve at the bank.
  const opening = addDays(earliestPosting, -30);
  const float = totalDisbursed + 250_000_000n;
  postLedger({
    type: 'OPENING_BALANCE',
    key: 'seed:opening',
    loanId: null,
    on: opening,
    postedAt: at(opening, 9),
    memo: 'Lending capital paid in',
    lines: [
      { account: 'MOMO_FLOAT', direction: 'DEBIT', amount: float },
      { account: 'BANK', direction: 'DEBIT', amount: 500_000_000n },
      { account: 'FUNDING', direction: 'CREDIT', amount: float + 500_000_000n },
    ],
    postedById: ids.staff.get('ADMIN'),
  });

  console.log('Inserted:');
  await insertMany('borrowers', rows.borrowers, (data) => prisma.borrower.createMany({ data }));
  await insertMany('businesses', rows.businesses, (data) => prisma.business.createMany({ data }));
  await insertMany('applications', rows.applications, (data) =>
    prisma.application.createMany({ data }),
  );
  await insertMany('credit scores', rows.scores, (data) => prisma.creditScore.createMany({ data }));
  await insertMany('loans', rows.loans, (data) => prisma.loan.createMany({ data }));
  await insertMany('instalments', rows.instalments, (data) =>
    prisma.scheduleInstalment.createMany({ data }),
  );

  // Ledger transactions and their entries go in one database transaction:
  // the balance check runs at COMMIT, and would reject either half alone.
  await prisma.$transaction(
    async (tx) => {
      await insertMany('ledger transactions', rows.ledgerTx, (data) =>
        tx.ledgerTransaction.createMany({ data }),
      );
      await insertMany('ledger entries', rows.ledgerEntries, (data) =>
        tx.ledgerEntry.createMany({ data }),
      );
    },
    { timeout: 300_000, maxWait: 20_000 },
  );
  await insertMany('payments', rows.payments, (data) => prisma.payment.createMany({ data }));
  await insertMany('disbursements', rows.disbursements, (data) =>
    prisma.disbursement.createMany({ data }),
  );
  await insertMany('collection cases', rows.cases, (data) =>
    prisma.collectionCase.createMany({ data }),
  );
  await insertMany('contact logs', rows.contacts, (data) => prisma.contactLog.createMany({ data }));
  await insertMany('promises to pay', rows.promises, (data) =>
    prisma.promiseToPay.createMany({ data }),
  );
  await insertMany('sms messages', rows.sms, (data) => prisma.smsMessage.createMany({ data }));
  await insertMany('notes', rows.notes, (data) => prisma.note.createMany({ data }));
  await insertMany('kyc documents', rows.kyc, (data) => prisma.kycDocument.createMany({ data }));
  await insertMany('consents', rows.consents, (data) => prisma.consent.createMany({ data }));
  await insertMany('notifications', rows.notifications, (data) =>
    prisma.notification.createMany({ data }),
  );
  await insertMany('momo inflow months', rows.inflows, (data) =>
    prisma.momoInflowMonth.createMany({ data }),
  );

  // Reference counters carry on from the highest number the seed used.
  const counters = new Map<string, number>([['BR', borrowerSeq]]);
  const bump = (key: string, value: number) =>
    counters.set(key, Math.max(counters.get(key) ?? 0, value));
  for (const app of rows.applications) bump('APP', Number(app.code.slice(4)));
  for (const loan of rows.loans) bump(`LN-${loan.code.slice(-4)}`, Number(loan.code.slice(3, 7)));
  await prisma.codeCounter.createMany({
    data: [...counters].map(([key, value]) => ({ key, value })),
  });

  await prisma.auditLog.create({
    data: {
      actorType: 'SYSTEM',
      action: 'system.seed',
      metadata: { asOf: TODAY, loans: rows.loans.length },
    },
  });

  // ── report, and check the result against the designs ──
  const active = seeded.filter((l) => l.active);
  const buckets = { CURRENT: 0, DPD_1_30: 0, DPD_31_90: 0, DPD_90_PLUS: 0 };
  let outstanding = 0n;
  for (const loan of active) {
    buckets[dpdBucket(loan.dpd)] += 1;
    outstanding += loan.outstanding;
  }
  const aline = seeded.find((l) => l.code === 'LN-0418-2026')!;
  console.log(`
Portfolio as seeded:
  active loans           ${active.length.toLocaleString('en-US')}   (design: 1,142)
  outstanding principal  ${formatRwfCompact(outstanding)}   (design: RWF 2.48B)
  DPD buckets            ${buckets.CURRENT} / ${buckets.DPD_1_30} / ${buckets.DPD_31_90} / ${buckets.DPD_90_PLUS}   (design: 1021 / 84 / 25 / 12)
  LN-0418-2026           instalment ${formatRwf(aline.schedule.instalment)}, outstanding ${formatRwf(aline.outstanding)}

Staff sign-ins (password: SEED_STAFF_PASSWORD in apps/api/.env):
${STAFF.map((s) => `  ${s.role.padEnd(18)} ${s.email}`).join('\n')}
`);

  const problems: string[] = [];
  if (active.length !== TARGET.activeLoans)
    problems.push(`expected ${TARGET.activeLoans} active loans`);
  for (const key of Object.keys(buckets) as Array<keyof typeof buckets>) {
    if (buckets[key] !== TARGET.buckets[key])
      problems.push(`bucket ${key} is ${buckets[key]}, expected ${TARGET.buckets[key]}`);
  }
  if (aline.schedule.instalment !== 284_985n)
    problems.push('LN-0418-2026 instalment should be RWF 284,985');
  const gap =
    outstanding > TARGET.outstanding
      ? outstanding - TARGET.outstanding
      : TARGET.outstanding - outstanding;
  if (gap * 100n > TARGET.outstanding)
    problems.push('outstanding principal is more than 1% away from RWF 2.48B');
  if (problems.length)
    throw new Error(`Seed does not match the designs:\n  - ${problems.join('\n  - ')}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
