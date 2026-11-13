import { describe, expect, it } from 'vitest';
import {
  applyBps,
  divRoundHalfUp,
  formatBps,
  formatRwf,
  formatRwfCompact,
  parseRwf,
  ratioBps,
  sumRwf,
  toRwf,
} from './money';

describe('formatRwf', () => {
  it('adds thousands separators and the currency', () => {
    expect(formatRwf(4_500_000n)).toBe('RWF 4,500,000');
    expect(formatRwf(64_300n)).toBe('RWF 64,300');
    expect(formatRwf(0n)).toBe('RWF 0');
    expect(formatRwf(999n)).toBe('RWF 999');
    expect(formatRwf(1_000n)).toBe('RWF 1,000');
  });
  it('can drop the symbol for table cells', () => {
    expect(formatRwf(284_985n, { symbol: false })).toBe('284,985');
  });
  it('handles negatives and amounts beyond Number.MAX_SAFE_INTEGER', () => {
    expect(formatRwf(-1_500n)).toBe('RWF −1,500');
    expect(formatRwf(9_007_199_254_740_993_123n)).toBe('RWF 9,007,199,254,740,993,123');
  });
});

describe('formatRwfCompact', () => {
  it('matches the headline figures in the designs', () => {
    expect(formatRwfCompact(2_480_000_000n)).toBe('RWF 2.48B');
    expect(formatRwfCompact(318_000_000n)).toBe('RWF 318M');
    expect(formatRwfCompact(14_200_000n)).toBe('RWF 14.2M');
    expect(formatRwfCompact(2_170_000n)).toBe('RWF 2.17M');
    expect(formatRwfCompact(6_000_000n)).toBe('RWF 6M');
    expect(formatRwfCompact(850_000n)).toBe('RWF 850K');
    expect(formatRwfCompact(999n)).toBe('RWF 999');
  });
  it('rounds half up at three significant digits', () => {
    expect(formatRwfCompact(3_124_999n)).toBe('RWF 3.12M');
    expect(formatRwfCompact(3_125_000n)).toBe('RWF 3.13M');
    expect(formatRwfCompact(999_999_999n)).toBe('RWF 1,000M');
  });
});

describe('parseRwf', () => {
  it('accepts plain, grouped and prefixed amounts', () => {
    expect(parseRwf('4500000')).toBe(4_500_000n);
    expect(parseRwf('4,500,000')).toBe(4_500_000n);
    expect(parseRwf(' RWF 4,500,000 ')).toBe(4_500_000n);
    expect(parseRwf('rwf 0')).toBe(0n);
  });
  it('rejects decimals, negatives and junk', () => {
    for (const bad of ['4500000.50', '-100', '', 'abc', '1e6', '12 francs', '4.5M']) {
      expect(() => parseRwf(bad), bad).toThrow(RangeError);
    }
  });
});

describe('integer helpers', () => {
  it('toRwf only takes safe whole numbers', () => {
    expect(toRwf(1_650_000)).toBe(1_650_000n);
    expect(() => toRwf(0.1 + 0.2)).toThrow(RangeError);
    expect(() => toRwf(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
    expect(() => toRwf(Number.NaN)).toThrow(RangeError);
  });
  it('divRoundHalfUp rounds .5 up', () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(4n, 2n)).toBe(2n);
    expect(divRoundHalfUp(1n, 3n)).toBe(0n);
    expect(divRoundHalfUp(2n, 3n)).toBe(1n);
    expect(() => divRoundHalfUp(1n, 0n)).toThrow(RangeError);
    expect(() => divRoundHalfUp(-1n, 2n)).toThrow(RangeError);
  });
  it('applyBps and ratioBps', () => {
    expect(applyBps(1_650_000n, 3500)).toBe(577_500n);
    expect(applyBps(333n, 5000)).toBe(167n);
    expect(ratioBps(31n, 1000n)).toBe(310);
    expect(ratioBps(5n, 0n)).toBe(0);
    expect(() => applyBps(100n, 12.5)).toThrow(RangeError);
  });
  it('formatBps and sumRwf', () => {
    expect(formatBps(310)).toBe('3.1%');
    expect(formatBps(9640)).toBe('96.4%');
    expect(formatBps(1700, 0)).toBe('17%');
    expect(sumRwf([1n, 2n, 3n])).toBe(6n);
    expect(sumRwf([])).toBe(0n);
  });
});
