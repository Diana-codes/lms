import { describe, expect, it } from 'vitest';
import {
  arrearsAt,
  BUREAU_COLUMNS,
  bureauField,
  bureauPeriod,
  bureauProblems,
  buildBureauFile,
  type BureauLoanRecord,
} from './bureau';

const record = (over: Partial<BureauLoanRecord> = {}): BureauLoanRecord => ({
  borrowerType: 'INDIVIDUAL',
  name: 'Aline Uwase',
  nationalId: '1199080012345678',
  registrationNumber: null,
  dateOfBirth: '1990-08-14',
  gender: 'FEMALE',
  phone: '+250788123412',
  district: 'Gasabo',
  customerNumber: 'BR-00731',
  accountNumber: 'LN-2026-0001',
  productName: 'SME working capital',
  dateOpened: '2026-01-15',
  maturityDate: '2027-01-15',
  termMonths: 12,
  principal: 1_200_000n,
  instalmentAmount: 109_000n,
  currentBalance: 650_000n,
  arrearsAmount: 0n,
  daysInArrears: 0,
  creditClass: 'NORMAL',
  status: 'ACTIVE',
  closedOn: null,
  writtenOffOn: null,
  writtenOffAmount: 0n,
  lastPaymentDate: '2026-10-15',
  lastPaymentAmount: 109_000n,
  collateralType: 'MOVABLE',
  collateralValue: 800_000n,
  guarantorCount: 1,
  ...over,
});

const header = {
  lenderCode: 'KL001',
  lenderName: 'Kora | Lend',
  periodEnd: '2026-10-31',
  createdOn: '2026-11-03',
};

describe('the monthly bureau file', () => {
  it('has a header, the column names, one row per loan and a trailer that adds up', () => {
    const file = buildBureauFile(header, [
      record({
        accountNumber: 'LN-2026-0002',
        currentBalance: 300_000n,
        arrearsAmount: 50_000n,
        daysInArrears: 12,
        creditClass: 'NORMAL',
      }),
      record(),
    ]);
    const lines = file.content.trimEnd().split('\r\n');
    expect(lines[0]).toBe('H|KL001|Kora Lend|20261031|20261103|kora-crb-v1');
    expect(lines[1]!.split('|')).toEqual(['C', ...BUREAU_COLUMNS.map((c) => c.name)]);
    expect(lines).toHaveLength(5);
    // Sorted by account number, so the file is the same however the rows came in.
    expect(lines[2]!.split('|')[10]).toBe('LN-2026-0001');
    expect(lines[4]).toBe('T|2|950000|50000');
    expect(file).toMatchObject({ recordCount: 2, totalBalance: 950_000n, totalArrears: 50_000n });
    const row = lines[2]!.split('|');
    expect(row).toHaveLength(BUREAU_COLUMNS.length);
    expect(row.slice(0, 10)).toEqual([
      'D',
      'I',
      'BR-00731',
      'Aline Uwase',
      '1199080012345678',
      '',
      '19900814',
      'F',
      '+250788123412',
      'Gasabo',
    ]);
  });

  it('reports companies by RDB code, without personal fields', () => {
    const file = buildBureauFile(header, [
      record({
        borrowerType: 'BUSINESS',
        name: 'Akagera Dairy Ltd',
        nationalId: null,
        registrationNumber: '102345678',
        dateOfBirth: null,
        gender: null,
      }),
    ]);
    const row = file.content.split('\r\n')[2]!.split('|');
    expect(row.slice(1, 8)).toEqual([
      'C',
      'BR-00731',
      'Akagera Dairy Ltd',
      '',
      '102345678',
      '',
      '',
    ]);
  });

  it('leaves out loans the bureau could not match, and says why', () => {
    const file = buildBureauFile(header, [
      record({ accountNumber: 'LN-1', nationalId: null }),
      record({ accountNumber: 'LN-2', nationalId: '123' }),
      record({ accountNumber: 'LN-3', borrowerType: 'BUSINESS', registrationNumber: null }),
      record({ accountNumber: 'LN-4', phone: '+256700000000' }),
      record({ accountNumber: 'LN-5' }),
    ]);
    expect(file.recordCount).toBe(1);
    expect(file.excluded.map((p) => [p.accountNumber, p.field])).toEqual([
      ['LN-1', 'NationalId'],
      ['LN-2', 'NationalId'],
      ['LN-3', 'RegistrationNumber'],
      ['LN-4', 'Phone'],
    ]);
  });

  it('marks closed and written-off loans with their dates and amounts', () => {
    const row = (r: BureauLoanRecord) => {
      const cells = buildBureauFile(header, [r]).content.split('\r\n')[2]!.split('|');
      const at = (name: string) => cells[BUREAU_COLUMNS.findIndex((c) => c.name === name)];
      return {
        status: at('AccountStatus'),
        closed: at('ClosedDate'),
        writtenOff: at('WrittenOffDate'),
        amount: at('WrittenOffAmount'),
        cls: at('Classification'),
      };
    };
    expect(row(record({ status: 'CLOSED', closedOn: '2026-10-20', currentBalance: 0n }))).toEqual({
      status: 'C',
      closed: '20261020',
      writtenOff: '',
      amount: '',
      cls: 'N',
    });
    expect(
      row(
        record({
          status: 'WRITTEN_OFF',
          writtenOffOn: '2026-10-05',
          writtenOffAmount: 640_000n,
          currentBalance: 0n,
          creditClass: 'LOSS',
        }),
      ),
    ).toEqual({ status: 'W', closed: '', writtenOff: '20261005', amount: '640000', cls: 'L' });
  });

  it('keeps names from breaking the layout', () => {
    expect(bureauField(' Uwase |\r\n Aline\t ')).toBe('Uwase Aline');
    expect(bureauProblems(record({ name: ' | ' }))).toEqual([
      { accountNumber: 'LN-2026-0001', field: 'Name', message: 'No name' },
    ]);
  });
});

describe('periods and arrears', () => {
  it('turns a month into its first and last day', () => {
    expect(bureauPeriod('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(bureauPeriod('2024-02').end).toBe('2024-02-29');
    expect(bureauPeriod('2026-12')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
    expect(() => bureauPeriod('2026-13')).toThrow(RangeError);
  });

  const schedule = [
    { dueDate: '2026-08-15', amount: 100_000n },
    { dueDate: '2026-09-15', amount: 100_000n },
    { dueDate: '2026-10-15', amount: 100_000n },
    { dueDate: '2026-11-15', amount: 100_000n },
  ];

  it('counts what fell due and was not covered, from the oldest gap', () => {
    expect(arrearsAt(schedule, 300_000n, '2026-10-31')).toEqual({
      arrearsAmount: 0n,
      daysInArrears: 0,
    });
    expect(arrearsAt(schedule, 150_000n, '2026-10-31')).toEqual({
      arrearsAmount: 150_000n,
      daysInArrears: 46, // 15 Sep to 31 Oct
    });
    expect(arrearsAt(schedule, 0n, '2026-10-31')).toEqual({
      arrearsAmount: 300_000n,
      daysInArrears: 77,
    });
  });

  it('does not count an instalment due on the reporting day', () => {
    expect(arrearsAt(schedule, 200_000n, '2026-10-15')).toEqual({
      arrearsAmount: 0n,
      daysInArrears: 0,
    });
  });
});
