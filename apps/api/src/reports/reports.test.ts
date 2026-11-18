import { describe, expect, it } from 'vitest';
import { monthEnds, reportToCsv } from './reports.service';

describe('monthEnds', () => {
  it('returns the last three month-ends for a quarter, capping this month at today', () => {
    expect(monthEnds('Q', '2026-11-14')).toEqual(['2026-09-30', '2026-10-31', '2026-11-14']);
  });

  it('returns twelve month-ends for 12M', () => {
    const ends = monthEnds('12M', '2026-11-14');
    expect(ends).toHaveLength(12);
    expect(ends[0]).toBe('2025-12-31');
    expect(ends[ends.length - 1]).toBe('2026-11-14');
  });

  it('returns January through the current month for YTD', () => {
    expect(monthEnds('YTD', '2026-03-05')).toEqual(['2026-01-31', '2026-02-28', '2026-03-05']);
  });

  it('on the last day of a month uses that day as the month end', () => {
    expect(monthEnds('Q', '2026-02-28')).toEqual(['2025-12-31', '2026-01-31', '2026-02-28']);
  });
});

describe('reportToCsv', () => {
  it('writes month, product and officer sections with CRLF and percent columns', () => {
    const csv = reportToCsv({
      period: 'Q',
      asOf: '2026-11-14',
      series: [
        {
          month: '2026-09-30',
          outstanding: 1_000_000n,
          activeLoans: 2,
          averageLoan: 500_000n,
          par30Bps: 250,
          yieldBps: 1800,
        },
      ],
      products: [{ name: 'Personal loan', outstanding: 1_000_000n, shareBps: 10_000 }],
      officers: [
        {
          name: 'Kevin N.',
          activeLoans: 2,
          portfolio: 1_000_000n,
          par30Bps: 0,
          collectionRateBps: 9550,
        },
      ],
    });
    expect(csv).toContain('Bridge to Finance report,Q,as of 2026-11-14');
    expect(csv).toContain('2026-09-30,1000000,2,500000,2.50,18.00');
    expect(csv).toContain('Personal loan,1000000,100.00');
    expect(csv).toContain('Kevin N.,2,1000000,0.00,95.50');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('quotes commas and neutralises spreadsheet formulas in names', () => {
    const csv = reportToCsv({
      period: '12M',
      asOf: '2026-11-14',
      series: [],
      products: [{ name: 'SME, working capital', outstanding: 10n, shareBps: 5000 }],
      officers: [
        {
          name: '=HYPERLINK("http://evil")',
          activeLoans: 1,
          portfolio: 10n,
          par30Bps: 0,
          collectionRateBps: null,
        },
      ],
    });
    expect(csv).toContain('"SME, working capital",10,50.00');
    expect(csv).toMatch(/'=HYPERLINK\(""http:\/\/evil""\)",1,10,0\.00,/);
  });
});
