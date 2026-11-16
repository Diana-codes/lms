import { isIsoDate, type IsoDate } from './dates';
import { normaliseRwPhone } from './mask';

/**
 * Importing a lender's existing loan book from a spreadsheet (PRD §6.14).
 * One row per active loan, borrower details on the same row. Values are
 * checked here so the console can show every problem before anything is
 * imported; the API then imports a clean file in one transaction.
 */

export interface MigrationColumn {
  key: keyof MigrationRow;
  header: string;
  required: boolean;
  help: string;
  example: string;
}

export const MIGRATION_COLUMNS: MigrationColumn[] = [
  {
    key: 'borrowerName',
    header: 'borrower_name',
    required: true,
    help: 'Full name as on the ID',
    example: 'Aline Uwase',
  },
  {
    key: 'phone',
    header: 'phone',
    required: true,
    help: 'Rwandan mobile number',
    example: '0788123412',
  },
  {
    key: 'nationalId',
    header: 'national_id',
    required: false,
    help: '16-digit national ID',
    example: '1199080012345678',
  },
  { key: 'gender', header: 'gender', required: false, help: 'F, M or blank', example: 'F' },
  {
    key: 'district',
    header: 'district',
    required: false,
    help: 'District of residence or business',
    example: 'Gasabo',
  },
  {
    key: 'loanRef',
    header: 'loan_ref',
    required: true,
    help: 'Your existing loan number (must be unique)',
    example: 'BF-2025-0142',
  },
  {
    key: 'productCode',
    header: 'product_code',
    required: true,
    help: 'A product code from Settings → Products',
    example: 'SME-WC',
  },
  {
    key: 'principal',
    header: 'principal',
    required: true,
    help: 'Amount originally lent, RWF',
    example: '2000000',
  },
  {
    key: 'annualRatePercent',
    header: 'annual_rate_percent',
    required: true,
    help: 'Nominal annual rate, e.g. 24',
    example: '24',
  },
  {
    key: 'termMonths',
    header: 'term_months',
    required: true,
    help: 'Original term in months',
    example: '12',
  },
  {
    key: 'disbursedOn',
    header: 'disbursed_on',
    required: true,
    help: 'Date paid out (YYYY-MM-DD or DD/MM/YYYY)',
    example: '2025-12-15',
  },
  {
    key: 'outstandingPrincipal',
    header: 'outstanding_principal',
    required: true,
    help: 'Principal still owed at cut-over, RWF (including any overdue principal)',
    example: '1250000',
  },
  {
    key: 'nextDueDate',
    header: 'next_due_date',
    required: true,
    help: 'Due date of the next scheduled instalment after cut-over (blank if none are left)',
    example: '2026-12-15',
  },
  {
    key: 'remainingInstalments',
    header: 'remaining_instalments',
    required: true,
    help: 'Monthly instalments still to come (not counting arrears)',
    example: '7',
  },
  {
    key: 'arrearsPrincipal',
    header: 'arrears_principal',
    required: false,
    help: 'Overdue principal at cut-over, RWF (0 if up to date)',
    example: '0',
  },
  {
    key: 'arrearsInterest',
    header: 'arrears_interest',
    required: false,
    help: 'Overdue interest at cut-over, RWF',
    example: '0',
  },
  {
    key: 'oldestArrearsDate',
    header: 'oldest_arrears_date',
    required: false,
    help: 'Due date of the oldest unpaid instalment, if in arrears',
    example: '',
  },
  {
    key: 'paidToDate',
    header: 'paid_to_date',
    required: false,
    help: 'Total repaid before cut-over, RWF (for the record)',
    example: '900000',
  },
  {
    key: 'collateral',
    header: 'collateral',
    required: false,
    help: 'What secures the loan, in words',
    example: 'Land title UPI 1/02/03/04/567',
  },
  {
    key: 'guarantorName',
    header: 'guarantor_name',
    required: false,
    help: 'Guarantor full name',
    example: '',
  },
  {
    key: 'guarantorPhone',
    header: 'guarantor_phone',
    required: false,
    help: 'Guarantor phone',
    example: '',
  },
  {
    key: 'officerEmail',
    header: 'officer_email',
    required: false,
    help: 'Email of the staff member who manages the loan',
    example: 'kevin@bf.rw',
  },
];

export interface MigrationRow {
  borrowerName: string;
  phone: string;
  nationalId: string | null;
  gender: 'FEMALE' | 'MALE' | null;
  district: string | null;
  loanRef: string;
  productCode: string;
  principal: bigint;
  annualRatePercent: number;
  /** The same rate in basis points. */
  annualRateBps: number;
  termMonths: number;
  disbursedOn: IsoDate;
  outstandingPrincipal: bigint;
  /** Null when nothing is left to come (everything outstanding is in arrears). */
  nextDueDate: IsoDate | null;
  remainingInstalments: number;
  arrearsPrincipal: bigint;
  arrearsInterest: bigint;
  oldestArrearsDate: IsoDate | null;
  paidToDate: bigint | null;
  collateral: string | null;
  guarantorName: string | null;
  guarantorPhone: string | null;
  officerEmail: string | null;
}

export interface RowResult {
  /** Spreadsheet line number (the header is line 1). */
  line: number;
  row: MigrationRow | null;
  errors: string[];
}

/** Find each template column in a header row, forgiving case, spaces and dashes. */
export function mapHeaders(headers: string[]): { index: Map<string, number>; missing: string[] } {
  const norm = (h: string) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
  const index = new Map<string, number>();
  headers.forEach((h, i) => index.set(norm(h), i));
  const missing = MIGRATION_COLUMNS.filter((c) => c.required && !index.has(c.header)).map(
    (c) => c.header,
  );
  return { index, missing };
}

/** "15/12/2025", "2025-12-15" or "15-12-2025" -> "2025-12-15"; null if not a real date. */
export function parseSheetDate(value: string): IsoDate | null {
  const v = value.trim();
  let iso: string | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) iso = v;
  else {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
    if (m) iso = `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  return iso && isIsoDate(iso) ? iso : null;
}

function amount(value: string): bigint | null {
  const v = value
    .trim()
    .replace(/^RWF\s*/i, '')
    .replace(/[,\s]/g, '');
  if (v === '') return null;
  if (/^\d+(\.0+)?$/.test(v)) return BigInt(v.split('.')[0]!);
  return Number.NaN as unknown as bigint;
}

const isBad = (v: unknown) => typeof v === 'number' && Number.isNaN(v);

/**
 * Check one spreadsheet row. `cells` is keyed by template header. `asOf` is
 * the cut-over date: dates must make sense relative to it.
 */
export function parseMigrationRow(
  cells: Record<string, string>,
  line: number,
  asOf: IsoDate,
): RowResult {
  const errors: string[] = [];
  const text = (h: string) => (cells[h] ?? '').toString().trim();
  const need = (h: string, label: string) => {
    const v = text(h);
    if (!v) errors.push(`${label} is missing`);
    return v;
  };

  const borrowerName = need('borrower_name', 'Borrower name');
  const rawPhone = need('phone', 'Phone');
  const phone = rawPhone ? normaliseRwPhone(rawPhone) : null;
  if (rawPhone && !phone) errors.push(`Phone "${rawPhone}" is not a Rwandan mobile number`);
  const nationalId = text('national_id').replace(/\s/g, '') || null;
  if (nationalId && !/^\d{16}$/.test(nationalId)) errors.push('National ID must be 16 digits');
  const g = text('gender').toUpperCase();
  const gender = g === 'F' || g === 'FEMALE' ? 'FEMALE' : g === 'M' || g === 'MALE' ? 'MALE' : null;
  if (g && !gender) errors.push('Gender must be F, M or blank');

  const loanRef = need('loan_ref', 'Loan reference');
  const productCode = need('product_code', 'Product code');

  const money = (h: string, label: string, required: boolean): bigint | null => {
    const raw = text(h);
    if (!raw) {
      if (required) errors.push(`${label} is missing`);
      return null;
    }
    const v = amount(raw);
    if (v == null || isBad(v)) {
      errors.push(`${label} must be a whole amount in RWF`);
      return null;
    }
    return v;
  };
  const whole = (h: string, label: string, min: number, max: number): number | null => {
    const raw = text(h);
    if (!raw) {
      errors.push(`${label} is missing`);
      return null;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      errors.push(`${label} must be a whole number from ${min} to ${max}`);
      return null;
    }
    return n;
  };
  const date = (h: string, label: string, required: boolean): IsoDate | null => {
    const raw = text(h);
    if (!raw) {
      if (required) errors.push(`${label} is missing`);
      return null;
    }
    const d = parseSheetDate(raw);
    if (!d) errors.push(`${label} "${raw}" is not a date (use YYYY-MM-DD)`);
    return d;
  };

  const principal = money('principal', 'Principal', true);
  const rateRaw = text('annual_rate_percent').replace('%', '');
  const rate = Number(rateRaw);
  if (!rateRaw) errors.push('Annual rate is missing');
  else if (!Number.isFinite(rate) || rate < 0 || rate > 100)
    errors.push('Annual rate must be a percentage from 0 to 100');
  const termMonths = whole('term_months', 'Term', 1, 360);
  const disbursedOn = date('disbursed_on', 'Disbursed on', true);
  const outstanding = money('outstanding_principal', 'Outstanding principal', true);
  const remaining = whole('remaining_instalments', 'Remaining instalments', 0, 360);
  const nextDue = date('next_due_date', 'Next due date', remaining !== 0);
  const arrearsPrincipal = money('arrears_principal', 'Arrears principal', false) ?? 0n;
  const arrearsInterest = money('arrears_interest', 'Arrears interest', false) ?? 0n;
  const oldestArrears = date('oldest_arrears_date', 'Oldest arrears date', false);
  const paidToDate = money('paid_to_date', 'Paid to date', false);

  if (disbursedOn && disbursedOn > asOf) errors.push('Disbursed on is after the cut-over date');
  if (outstanding != null && outstanding <= 0n)
    errors.push('Outstanding principal must be above zero (leave repaid loans out)');
  if (principal != null && outstanding != null && outstanding > principal)
    errors.push('Outstanding principal is more than the amount lent');
  if (outstanding != null && arrearsPrincipal > outstanding)
    errors.push('Arrears principal is more than the outstanding principal');
  if (nextDue && nextDue <= asOf && remaining)
    errors.push(
      'Next due date must be after the cut-over date; put earlier instalments in arrears',
    );
  if (disbursedOn && nextDue && nextDue <= disbursedOn)
    errors.push('Next due date is before the loan was disbursed');
  if ((arrearsPrincipal > 0n || arrearsInterest > 0n) && !oldestArrears)
    errors.push('Give the oldest arrears date for a loan in arrears');
  if (oldestArrears && oldestArrears > asOf)
    errors.push('Oldest arrears date is after the cut-over date');
  if (oldestArrears && disbursedOn && oldestArrears <= disbursedOn)
    errors.push('Oldest arrears date is before the loan was disbursed');
  if (remaining === 0 && outstanding != null && outstanding > arrearsPrincipal)
    errors.push('With no remaining instalments, everything outstanding must be in arrears');
  if (
    remaining != null &&
    remaining > 0 &&
    outstanding != null &&
    outstanding - arrearsPrincipal <= 0n
  )
    errors.push('Nothing is left for the remaining instalments; set remaining_instalments to 0');

  const guarantorName = text('guarantor_name') || null;
  const rawGuarantorPhone = text('guarantor_phone');
  const guarantorPhone = rawGuarantorPhone ? normaliseRwPhone(rawGuarantorPhone) : null;
  if (rawGuarantorPhone && !guarantorPhone)
    errors.push('Guarantor phone is not a Rwandan mobile number');
  const officerEmail = text('officer_email').toLowerCase() || null;

  if (errors.length) return { line, row: null, errors };
  return {
    line,
    errors,
    row: {
      borrowerName,
      phone: phone!,
      nationalId,
      gender,
      district: text('district') || null,
      loanRef,
      productCode,
      principal: principal!,
      annualRatePercent: rate,
      annualRateBps: Math.round(rate * 100),
      termMonths: termMonths!,
      disbursedOn: disbursedOn!,
      outstandingPrincipal: outstanding!,
      nextDueDate: remaining === 0 ? null : nextDue!,
      remainingInstalments: remaining!,
      arrearsPrincipal,
      arrearsInterest,
      oldestArrearsDate: oldestArrears,
      paidToDate,
      collateral: text('collateral') || null,
      guarantorName,
      guarantorPhone,
      officerEmail,
    },
  };
}

/** Rows that repeat a loan reference, national ID or phone with a different name. */
export function crossRowProblems(results: RowResult[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const add = (line: number, msg: string) => out.set(line, [...(out.get(line) ?? []), msg]);
  const refs = new Map<string, number>();
  const names = new Map<string, { name: string; line: number }>();
  const ids = new Map<string, { phone: string; line: number }>();
  for (const r of results) {
    if (!r.row) continue;
    const ref = r.row.loanRef.toLowerCase();
    if (refs.has(ref)) add(r.line, `Loan reference repeats line ${refs.get(ref)}`);
    else refs.set(ref, r.line);
    const prev = names.get(r.row.phone);
    if (prev && prev.name.toLowerCase() !== r.row.borrowerName.toLowerCase())
      add(r.line, `Phone is also used by "${prev.name}" on line ${prev.line}`);
    else if (!prev) names.set(r.row.phone, { name: r.row.borrowerName, line: r.line });
    if (r.row.nationalId) {
      const p = ids.get(r.row.nationalId);
      if (p && p.phone !== r.row.phone)
        add(r.line, `National ID is also on line ${p.line} with another phone`);
      else if (!p) ids.set(r.row.nationalId, { phone: r.row.phone, line: r.line });
    }
  }
  return out;
}

/** The template as CSV: headers and one example row. */
export function migrationTemplateCsv(): string {
  const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return (
    [
      MIGRATION_COLUMNS.map((c) => c.header).join(','),
      MIGRATION_COLUMNS.map((c) => quote(c.example)).join(','),
    ].join('\r\n') + '\r\n'
  );
}

/** Split CSV text into rows of cells (RFC 4180: quotes, embedded commas and newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  // Excel in some regions saves with semicolons; tell from the header line.
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = !firstLine.includes(',') && firstLine.includes(';') ? ';' : ',';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
