import { describe, expect, it } from 'vitest';
import { compareNames, identityFindings, idNumberBirthYear } from './identity';

const base = {
  nameOnId: 'MUKAMANA Grace',
  idNumberOnId: '1199080012345012',
  dateOfBirth: '1990-04-02',
  givenName: 'Grace Mukamana',
  idNumberMatches: true,
  statementHolders: ['GRACE MUKAMANA'],
  currentYear: 2026,
};

describe('identity checks', () => {
  it('compares names ignoring case, accents and order', () => {
    expect(compareNames('MUKAMANA Grace', 'grace mukamana')).toBe('MATCH');
    expect(compareNames('Béatrice Uwizeye', 'Beatrice UWIZEYE')).toBe('MATCH');
    expect(compareNames('Grace Mukamana Uwase', 'Grace Mukamana')).toBe('MATCH');
    expect(compareNames('Grace Mukamana', 'Grace Uwase')).toBe('PARTIAL');
    expect(compareNames('Jean Habimana', 'Grace Mukamana')).toBe('MISMATCH');
    expect(compareNames(null, 'Grace')).toBe('UNKNOWN');
  });

  it('reads the birth year from the ID number', () => {
    expect(idNumberBirthYear('1 1990 8 0012345 0 12')).toBe(1990);
    expect(idNumberBirthYear('12345')).toBeNull();
  });

  it('raises nothing when everything agrees', () => {
    expect(identityFindings(base)).toEqual({ nameMatch: 'MATCH', flags: [] });
  });

  it('flags a different name, number, statement holder and a young age', () => {
    const r = identityFindings({
      ...base,
      nameOnId: 'Jean Habimana',
      idNumberOnId: '1201280012345012',
      dateOfBirth: '2012-01-01',
      idNumberMatches: false,
    });
    expect(r.nameMatch).toBe('MISMATCH');
    expect(r.flags.map((f) => f.code)).toEqual([
      'NAME_MISMATCH',
      'ID_NUMBER_MISMATCH',
      'UNDER_AGE',
      'STATEMENT_NAME_MISMATCH',
    ]);
  });

  it('flags a printed birth date that disagrees with the ID number', () => {
    const r = identityFindings({ ...base, dateOfBirth: '1985-04-02' });
    expect(r.flags.map((f) => f.code)).toEqual(['BIRTH_YEAR_MISMATCH']);
  });
});
