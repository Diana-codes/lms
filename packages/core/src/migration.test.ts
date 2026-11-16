import { describe, expect, it } from 'vitest';
import {
  crossRowProblems,
  mapHeaders,
  MIGRATION_COLUMNS,
  migrationTemplateCsv,
  parseCsv,
  parseMigrationRow,
  parseSheetDate,
} from './migration';

const asOf = '2026-11-16';
const good: Record<string, string> = {
  borrower_name: 'Aline Uwase',
  phone: '0788 123 412',
  national_id: '1199080012345678',
  gender: 'f',
  loan_ref: 'BF-2025-0142',
  product_code: 'SME-WC',
  principal: '2,000,000',
  annual_rate_percent: '24%',
  term_months: '12',
  disbursed_on: '15/12/2025',
  outstanding_principal: '1250000',
  next_due_date: '2026-12-15',
  remaining_instalments: '7',
};

describe('parseMigrationRow', () => {
  it('accepts a clean row and normalises its values', () => {
    const r = parseMigrationRow(good, 2, asOf);
    expect(r.errors).toEqual([]);
    expect(r.row).toMatchObject({
      phone: '+250788123412',
      gender: 'FEMALE',
      principal: 2_000_000n,
      annualRateBps: 2400,
      disbursedOn: '2025-12-15',
      arrearsPrincipal: 0n,
    });
  });

  it('lists every problem on a bad row at once', () => {
    const r = parseMigrationRow(
      {
        ...good,
        phone: '12345',
        national_id: '123',
        principal: '1500.50',
        outstanding_principal: '3000000',
        next_due_date: '2026-10-01',
        arrears_principal: '100000',
      },
      7,
      asOf,
    );
    expect(r.row).toBeNull();
    expect(r.errors).toEqual(
      expect.arrayContaining([
        'Phone "12345" is not a Rwandan mobile number',
        'National ID must be 16 digits',
        'Principal must be a whole amount in RWF',
        'Next due date must be after the cut-over date; put earlier instalments in arrears',
        'Give the oldest arrears date for a loan in arrears',
      ]),
    );
  });

  it('checks arrears against the outstanding balance and dates', () => {
    const r = parseMigrationRow(
      {
        ...good,
        arrears_principal: '1300000',
        arrears_interest: '50000',
        oldest_arrears_date: '2026-12-01',
      },
      3,
      asOf,
    );
    expect(r.errors).toContain('Arrears principal is more than the outstanding principal');
    expect(r.errors).toContain('Oldest arrears date is after the cut-over date');
  });

  it('accepts a loan entirely in arrears with nothing still to come', () => {
    const r = parseMigrationRow(
      {
        ...good,
        remaining_instalments: '0',
        arrears_principal: '1250000',
        oldest_arrears_date: '2026-06-15',
      },
      4,
      asOf,
    );
    expect(r.errors).toEqual([]);
  });
});

describe('crossRowProblems', () => {
  it('finds repeated loan numbers and phones shared by different names', () => {
    const a = parseMigrationRow(good, 2, asOf);
    const b = parseMigrationRow({ ...good, borrower_name: 'Someone Else' }, 3, asOf);
    const problems = crossRowProblems([a, b]);
    expect(problems.get(3)).toEqual([
      'Loan reference repeats line 2',
      'Phone is also used by "Aline Uwase" on line 2',
    ]);
  });
});

describe('helpers', () => {
  it('reads dates in the usual spreadsheet forms', () => {
    expect(parseSheetDate('2026-02-28')).toBe('2026-02-28');
    expect(parseSheetDate('5/3/2026')).toBe('2026-03-05');
    expect(parseSheetDate('31/02/2026')).toBeNull();
    expect(parseSheetDate('March 5')).toBeNull();
  });

  it('maps headers loosely and reports missing required columns', () => {
    const { index, missing } = mapHeaders(['Borrower Name', 'PHONE', 'loan-ref']);
    expect(index.get('borrower_name')).toBe(0);
    expect(index.get('loan_ref')).toBe(2);
    expect(missing).toContain('principal');
    expect(missing).not.toContain('phone');
  });

  it('parses quoted CSV and round-trips the template', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3\n')).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv('a;b\r\n1;x, y\r\n')).toEqual([
      ['a', 'b'],
      ['1', 'x, y'],
    ]);
    const [header] = parseCsv(migrationTemplateCsv());
    expect(header).toEqual(MIGRATION_COLUMNS.map((c) => c.header));
  });
});
