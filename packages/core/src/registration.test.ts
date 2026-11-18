import { describe, expect, it } from 'vitest';
import { certainlyUnderAge, isRwNationalId, nationalIdBirthYear } from './registration';

describe('national ID checks', () => {
  it('accepts 16 digits starting 1, 2 or 3', () => {
    expect(isRwNationalId('1199080012345012')).toBe(true);
    expect(isRwNationalId('3198570012345012')).toBe(true);
    expect(isRwNationalId('4199080012345012')).toBe(false);
    expect(isRwNationalId('119908001234501')).toBe(false);
    expect(isRwNationalId('11990800123450a2')).toBe(false);
  });

  it('reads the birth year', () => {
    expect(nationalIdBirthYear('1199080012345012', 2026)).toBe(1990);
    expect(nationalIdBirthYear('1203080012345012', 2026)).toBeNull();
    expect(nationalIdBirthYear('1180080012345012', 2026)).toBeNull();
  });

  it('only refuses someone certainly under 18', () => {
    expect(certainlyUnderAge(2009, 2026)).toBe(true);
    expect(certainlyUnderAge(2008, 2026)).toBe(false);
    expect(certainlyUnderAge(1990, 2026)).toBe(false);
  });
});
