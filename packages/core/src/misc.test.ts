import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  formatDate,
  formatMonthYear,
  isIsoDate,
  isoToUtcDate,
  kigaliDate,
  kigaliStartOfDay,
  utcDateToIso,
} from './dates';
import { canMoveStage, scoreBand, scorePercent } from './domain';
import {
  initials,
  maskEmail,
  maskNationalId,
  maskPhone,
  isMtnRwPhone,
  normaliseRwPhone,
  redactPii,
} from './mask';

describe('dates', () => {
  it('adds months with end-of-month clamping', () => {
    expect(addMonths('2026-05-04', 1)).toBe('2026-06-04');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-03-15', -4)).toBe('2025-11-15');
  });
  it('adds and counts days', () => {
    expect(addDays('2026-11-12', -104)).toBe('2026-07-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-07-31', '2026-11-12')).toBe(104);
    expect(daysBetween('2026-11-12', '2026-11-10')).toBe(-2);
  });
  it('validates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('12/11/2026')).toBe(false);
    expect(() => addMonths('nope', 1)).toThrow(RangeError);
  });
  it('uses the Kigali calendar day', () => {
    expect(kigaliDate(new Date('2026-11-12T21:59:00Z'))).toBe('2026-11-12');
    // A Kigali day starts at 22:00 UTC the evening before.
    expect(kigaliStartOfDay('2026-11-13').toISOString()).toBe('2026-11-12T22:00:00.000Z');
    expect(kigaliDate(new Date('2026-11-12T22:00:00Z'))).toBe('2026-11-13');
  });
  it('round-trips through Date and formats like the designs', () => {
    expect(utcDateToIso(isoToUtcDate('2026-05-04'))).toBe('2026-05-04');
    expect(formatDate('2026-05-04')).toBe('4 May 2026');
    expect(formatDate('2026-12-04', { year: false })).toBe('4 Dec');
    expect(formatMonthYear('2027-11-04')).toBe('Nov 2027');
  });
});

describe('masking', () => {
  it('masks phones the way the designs show them', () => {
    expect(maskPhone('+250788123412')).toBe('+250 78• ••• 412');
    expect(maskPhone('+250 72 555 0118')).toBe('+250 72• ••• 118');
    expect(maskPhone('0788123412')).toBe('•••••••412');
    expect(maskPhone('')).toBe('');
    expect(maskPhone(null)).toBe('');
    expect(maskPhone('12345')).toBe('•••••');
  });
  it('never leaks more than the last three digits of an ID', () => {
    const masked = maskNationalId('1198780012345821');
    expect(masked).toBe('•••• •••• •••• •821');
    expect(masked.replace(/\D/g, '')).toBe('821');
    expect(maskNationalId('12')).toBe('••');
    expect(maskNationalId(undefined)).toBe('');
  });
  it('masks emails', () => {
    expect(maskEmail('aline.uwase@example.com')).toBe('a••••@example.com');
    expect(maskEmail('bad')).toBe('••••');
  });
  it('scrubs PII out of log text', () => {
    const out = redactPii('Called +250788123412 and 0722550118 about ID 1198780012345821 today');
    expect(out).toBe(
      'Called +250 78• ••• 412 and +250 72• ••• 118 about ID •••• •••• •••• •821 today',
    );
    expect(redactPii('Loan LN-0418-2026 for RWF 4,500,000')).toBe(
      'Loan LN-0418-2026 for RWF 4,500,000',
    );
  });
  it('normalises Rwandan mobile numbers', () => {
    expect(normaliseRwPhone('0788 123 412')).toBe('+250788123412');
    expect(normaliseRwPhone('+250 722 550 118')).toBe('+250722550118');
    expect(normaliseRwPhone('788123412')).toBe('+250788123412');
    expect(normaliseRwPhone('0758123412')).toBeNull();
    expect(normaliseRwPhone('12345')).toBeNull();
  });
  it('tells MTN numbers from Airtel ones', () => {
    expect(isMtnRwPhone('+250788123412')).toBe(true);
    expect(isMtnRwPhone('+250798123412')).toBe(true);
    expect(isMtnRwPhone('+250722550118')).toBe(false);
    expect(isMtnRwPhone('+250732550118')).toBe(false);
    expect(isMtnRwPhone('0788123412')).toBe(false);
  });
  it('builds initials', () => {
    expect(initials('Aline Uwase')).toBe('AU');
    expect(initials('Jean-Paul Mugisha')).toBe('JP');
    expect(initials('Kalisa Trading Ltd')).toBe('KT');
    expect(initials('Cher')).toBe('C');
    expect(initials('')).toBe('');
  });
});

describe('domain', () => {
  it('only allows forward pipeline moves, plus decline and withdraw', () => {
    expect(canMoveStage('NEW', 'UNDER_REVIEW')).toBe(true);
    expect(canMoveStage('APPROVED', 'DISBURSED')).toBe(true);
    expect(canMoveStage('NEW', 'DISBURSED')).toBe(false);
    expect(canMoveStage('DISBURSED', 'DECLINED')).toBe(false);
    expect(canMoveStage('DECLINED', 'NEW')).toBe(false);
  });
  it('bands scores as the pipeline does', () => {
    expect(scoreBand(742)).toBe('strong');
    expect(scoreBand(688)).toBe('fair');
    expect(scoreBand(594)).toBe('weak');
    expect(scorePercent(300)).toBe(0);
    expect(scorePercent(850)).toBe(100);
    expect(scorePercent(742)).toBe(80);
    expect(scorePercent(9999)).toBe(100);
  });
});
