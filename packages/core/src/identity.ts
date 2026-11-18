import { MIN_BORROWER_AGE } from './registration';

/**
 * Comparing what a national ID photo says with what the borrower told us.
 * Pure: the API reads the card (with AI) and passes the facts in. Advisory
 * only: findings are shown to staff, who decide.
 */

export type NameMatch = 'MATCH' | 'PARTIAL' | 'MISMATCH' | 'UNKNOWN';

export interface IdentityFlag {
  code:
    | 'NAME_MISMATCH'
    | 'NAME_PARTIAL'
    | 'ID_NUMBER_MISMATCH'
    | 'BIRTH_YEAR_MISMATCH'
    | 'UNDER_AGE'
    | 'STATEMENT_NAME_MISMATCH';
  severity: 'HIGH' | 'MEDIUM';
  message: string;
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z]+/)
      .filter((w) => w.length > 1),
  );

/**
 * How well two names agree, ignoring case, accents and order. MATCH: every
 * word of the shorter name is in the longer one (at least two words, or the
 * whole name when it has one). PARTIAL: some words in common. MISMATCH: none.
 */
export function compareNames(a: string | null | undefined, b: string | null | undefined): NameMatch {
  if (!a?.trim() || !b?.trim()) return 'UNKNOWN';
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 'UNKNOWN';
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  const shorter = Math.min(x.size, y.size);
  if (common === shorter && (common >= 2 || shorter === 1)) return 'MATCH';
  return common > 0 ? 'PARTIAL' : 'MISMATCH';
}

/** The birth year a Rwandan ID number encodes (digits 2–5), if it looks like one. */
export function idNumberBirthYear(idNumber: string | null | undefined): number | null {
  const d = (idNumber ?? '').replace(/\D/g, '');
  if (d.length !== 16) return null;
  const y = Number(d.slice(1, 5));
  return y >= 1900 && y <= 2100 ? y : null;
}

export interface IdentityInput {
  /** As printed on the card. */
  nameOnId: string | null;
  idNumberOnId: string | null;
  /** YYYY-MM-DD as printed, if the card shows one. */
  dateOfBirth: string | null;
  /** What the borrower gave us. */
  givenName: string;
  /** Whether the number on the card is the one they gave (compared by hash); null when not compared. */
  idNumberMatches: boolean | null;
  /** Account holder names read from their statements. */
  statementHolders: string[];
  currentYear: number;
}

export function identityFindings(input: IdentityInput): {
  nameMatch: NameMatch;
  flags: IdentityFlag[];
} {
  const flags: IdentityFlag[] = [];
  const nameMatch = compareNames(input.nameOnId, input.givenName);
  if (nameMatch === 'MISMATCH') {
    flags.push({
      code: 'NAME_MISMATCH',
      severity: 'HIGH',
      message: `The name on the ID (${input.nameOnId}) does not match the name given (${input.givenName}).`,
    });
  } else if (nameMatch === 'PARTIAL') {
    flags.push({
      code: 'NAME_PARTIAL',
      severity: 'MEDIUM',
      message: `The name on the ID (${input.nameOnId}) only partly matches the name given (${input.givenName}).`,
    });
  }
  if (input.idNumberMatches === false) {
    flags.push({
      code: 'ID_NUMBER_MISMATCH',
      severity: 'HIGH',
      message: 'The ID number on the card is not the number the borrower gave.',
    });
  }
  const fromNumber = idNumberBirthYear(input.idNumberOnId);
  const printedYear = input.dateOfBirth ? Number(input.dateOfBirth.slice(0, 4)) : null;
  if (fromNumber && printedYear && fromNumber !== printedYear) {
    flags.push({
      code: 'BIRTH_YEAR_MISMATCH',
      severity: 'MEDIUM',
      message: `The date of birth on the card (${printedYear}) does not agree with its ID number (${fromNumber}). Check the card is genuine.`,
    });
  }
  const year = printedYear ?? fromNumber;
  if (year && input.currentYear - year < MIN_BORROWER_AGE) {
    flags.push({
      code: 'UNDER_AGE',
      severity: 'HIGH',
      message: `The card shows a birth year of ${year}: the borrower may be under ${MIN_BORROWER_AGE}.`,
    });
  }
  for (const holder of input.statementHolders) {
    if (compareNames(input.nameOnId, holder) === 'MISMATCH') {
      flags.push({
        code: 'STATEMENT_NAME_MISMATCH',
        severity: 'HIGH',
        message: `A statement is in the name of ${holder}, not the name on the ID (${input.nameOnId}).`,
      });
    }
  }
  return { nameMatch, flags };
}
