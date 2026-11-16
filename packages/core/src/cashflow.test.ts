import { describe, expect, it } from 'vitest';
import {
  analyseCashflow,
  balanceBreaks,
  categorise,
  type CashflowTxn,
  namesMatch,
  parseStatementCsv,
  parseStatementDate,
} from './cashflow';
import { parseCsv } from './migration';

let n = 0;
const tx = (
  date: string,
  amount: bigint,
  direction: 'IN' | 'OUT',
  description: string,
  balance: bigint | null = null,
): CashflowTxn => ({
  id: `t${++n}`,
  date,
  amount,
  direction,
  description,
  balance,
  category: categorise(description, direction),
  documentId: 'd1',
});

/** Six months of a trader: sales most days, rent, school fees, a MoKash loan. */
function trader(): CashflowTxn[] {
  const out: CashflowTxn[] = [];
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  for (const m of months) {
    out.push(tx(`${m}-03`, 300_000n, 'IN', 'MoMo Pay merchant payment received'));
    out.push(tx(`${m}-12`, 250_000n, 'IN', 'MoMo Pay merchant payment received'));
    out.push(tx(`${m}-05`, 80_000n, 'OUT', 'Rent to landlord'));
    out.push(tx(`${m}-06`, 20_000n, 'OUT', 'EUCL Cash power'));
    out.push(tx(`${m}-20`, 50_000n, 'OUT', 'MoKash loan repayment'));
  }
  out.push(tx('2026-09-15', 120_000n, 'OUT', 'School fees GS Kacyiru'));
  return out;
}

describe('categorise', () => {
  it('reads common Rwandan statement descriptions', () => {
    expect(categorise('SALARY OCT 2026 MINECOFIN', 'IN')).toBe('SALARY');
    expect(categorise('Received from +250788123412', 'IN')).toBe('TRANSFER_IN');
    expect(categorise('MoKash loan disbursement', 'IN')).toBe('LOAN_RECEIVED');
    expect(categorise('BetPawa deposit', 'OUT')).toBe('BETTING');
    expect(categorise('Cash out at agent 12345', 'OUT')).toBe('CASH_WITHDRAWAL');
    expect(categorise('Something odd', 'OUT')).toBe('OTHER_OUT');
  });
});

describe('analyseCashflow', () => {
  it('works out income, commitments, other debt and an affordable range', () => {
    const r = analyseCashflow({
      txns: trader(),
      payslips: [],
      holderNames: [],
      borrowerName: 'Aline Uwase',
      duplicateDocumentIds: [],
      aiReadDocumentIds: [],
      applicationDate: '2026-11-10',
    });
    expect(r.monthsCovered).toBe(6);
    expect(r.averageIncome.value).toBe(550_000n);
    expect(r.monthsWithIncome).toBe(6);
    expect(r.variationBps).toBe(0);
    expect(r.incomeBySource[0]).toMatchObject({ category: 'BUSINESS_SALES', shareBps: 10_000 });
    // Rent 80K + power 20K a month, plus school fees 120K spread over the 4 full months.
    expect(r.recurringCommitments.value).toBe(130_000n);
    expect(r.existingDebtRepayments.value).toBe(50_000n);
    expect(r.netDisposable.value).toBe(370_000n);
    // 35% of 550K = 192,500, less 50K other debt = 142,500.
    expect(r.affordable).toMatchObject({ high: 142_500n, low: 99_750n, dsrBps: 3500 });
    expect(r.averageIncome.sources).toHaveLength(12);
    expect(r.flags.map((f) => f.code)).toEqual(['OTHER_LENDERS']);
    // No balances on these rows, so confidence is medium, not high.
    expect(r.averageIncome.confidence).toBe('MEDIUM');
    expect(r.summary).toMatch(/Average monthly income RWF 550,000/);
  });

  it('flags short, gappy, edited and borrowed-looking statements', () => {
    const rows = [
      tx('2026-07-01', 100_000n, 'IN', 'Received from +250788000001', 100_000n),
      tx('2026-07-10', 20_000n, 'OUT', 'BetPawa', 80_000n),
      tx('2026-07-15', 50_000n, 'IN', 'Received from +250788000002', 999_999n),
      tx('2026-09-20', 3_000_000n, 'IN', 'Deposit', null),
    ];
    const r = analyseCashflow({
      txns: rows,
      payslips: [
        {
          documentId: 'p1',
          employer: 'X',
          employeeName: 'Someone Else',
          payPeriod: null,
          gross: null,
          deductions: null,
          net: 400_000n,
        },
      ],
      holderNames: [{ documentId: 'd1', name: 'Jean Paul Nkusi' }],
      borrowerName: 'Aline Uwase',
      duplicateDocumentIds: ['d1'],
      aiReadDocumentIds: ['d1'],
      applicationDate: '2026-10-01',
    });
    const codes = r.flags.map((f) => f.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'BALANCE_BREAK',
        'SHORT_PERIOD',
        'MISSING_MONTHS',
        'LARGE_RECENT_DEPOSIT',
        'NAME_MISMATCH',
        'DUPLICATE_DOCUMENT',
        'BETTING',
      ]),
    );
    expect(r.flags.find((f) => f.code === 'BALANCE_BREAK')!.evidence).toEqual([rows[2]!.id]);
    expect(r.averageIncome.confidence).toBe('LOW');
  });

  it('compares payslip net pay with salary actually received', () => {
    const r = analyseCashflow({
      txns: ['2026-08', '2026-09', '2026-10'].map((m) =>
        tx(`${m}-25`, 300_000n, 'IN', 'SALARY PAYMENT'),
      ),
      payslips: [
        {
          documentId: 'p1',
          employer: 'BK',
          employeeName: 'Aline Uwase',
          payPeriod: '2026-10',
          gross: 520_000n,
          deductions: 120_000n,
          net: 400_000n,
        },
      ],
      holderNames: [],
      borrowerName: 'Aline Uwase',
      duplicateDocumentIds: [],
      aiReadDocumentIds: [],
      applicationDate: '2026-11-01',
    });
    expect(r.payslipNet).toBe(400_000n);
    expect(r.salaryCredits).toBe(300_000n);
    expect(r.flags.map((f) => f.code)).toContain('PAYSLIP_MISMATCH');
  });

  it('says so plainly when nothing could be read', () => {
    const r = analyseCashflow({
      txns: [],
      payslips: [],
      holderNames: [],
      borrowerName: 'A',
      duplicateDocumentIds: [],
      aiReadDocumentIds: [],
      applicationDate: '2026-11-01',
    });
    expect(r.averageIncome.value).toBe(0n);
    expect(r.summary).toMatch(/manual review/);
  });
});

describe('statements', () => {
  it('reads an MTN MoMo style CSV with money in/out and balance', () => {
    const csv = parseCsv(
      'Id,Date,Description,Money In,Money Out,Balance\r\n' +
        '1,03/09/2026 10:15,Received from +250788000001,"50,000",,150000\r\n' +
        '2,04/09/2026 08:00,Cash power EUCL,,"5,000",145000\r\n',
    );
    const rows = parseStatementCsv(csv, 'd1')!;
    expect(rows).toEqual([
      expect.objectContaining({
        date: '2026-09-03',
        amount: 50_000n,
        direction: 'IN',
        balance: 150_000n,
      }),
      expect.objectContaining({
        date: '2026-09-04',
        amount: 5_000n,
        direction: 'OUT',
        balance: 145_000n,
      }),
    ]);
  });

  it('reads a bank CSV with signed amounts and returns null for unknown layouts', () => {
    const rows = parseStatementCsv(
      parseCsv(
        'Transaction Date,Narration,Amount\r\n2026-10-01,Salary,600000\r\n2026-10-02,ATM,-50000\r\n',
      ),
      'd2',
    )!;
    expect(rows.map((r) => [r.direction, r.amount])).toEqual([
      ['IN', 600_000n],
      ['OUT', 50_000n],
    ]);
    expect(parseStatementCsv(parseCsv('a,b\r\n1,2\r\n'), 'd3')).toBeNull();
  });

  it('parses statement dates and spots balance breaks', () => {
    expect(parseStatementDate('4-May-2026')).toBe('2026-05-04');
    expect(parseStatementDate('2026-05-04 13:22:01')).toBe('2026-05-04');
    expect(parseStatementDate('31/02/2026')).toBeNull();
    const a = tx('2026-01-01', 10n, 'IN', 'x', 110n);
    const b = tx('2026-01-02', 5n, 'OUT', 'y', 104n);
    const c = tx('2026-01-03', 5n, 'OUT', 'z', 99n);
    expect(balanceBreaks([a, b, c])).toEqual([b.id]);
  });

  it('matches names regardless of order and accents', () => {
    expect(namesMatch('UWASE Aline', 'Aline Uwase')).toBe(true);
    expect(namesMatch('Jean Paul Nkusi', 'Aline Uwase')).toBe(false);
  });
});
