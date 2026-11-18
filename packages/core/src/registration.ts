/**
 * Signing up in the borrower app. A new customer proves they own their phone
 * number with an SMS code, then gives these details. An officer still checks
 * their ID before any loan is approved.
 */

/** Version of the sign-up consent wording; stored on each consent record. */
export const REGISTRATION_CONSENT_VERSION = '2026-11-register';

/** Borrowers must be adults. */
export const MIN_BORROWER_AGE = 18;

export const BUSINESS_SECTORS = [
  'Garments & tailoring',
  'Retail shop',
  'Agriculture',
  'Transport',
  'Food & restaurants',
  'Services',
  'Other',
] as const;

/**
 * What the borrower agrees to when signing up, shown in full on the screen.
 * DRAFT: wording to be reviewed against Law Nº 058/2021 before launch.
 */
export const REGISTRATION_PRIVACY_POINTS = [
  'We use your name, phone number, national ID and business details to open your account, check who you are and decide on loans.',
  'Your data is stored in Rwanda and protected. Staff see your phone and ID numbers masked.',
  'We do not share your data with anyone else without your consent, except where the law requires it.',
  'You can ask to see, correct or delete your data at any time by contacting us.',
] as const;

/**
 * Basic shape of a Rwandan national ID: 16 digits, starting with 1 (Rwandan),
 * 2 (refugee) or 3 (foreign resident), then the four-digit birth year.
 */
export function isRwNationalId(id: string): boolean {
  return /^[123]\d{15}$/.test(id);
}

/** The birth year in a national ID, or null if it doesn't look like one. */
export function nationalIdBirthYear(id: string, currentYear: number): number | null {
  if (!isRwNationalId(id)) return null;
  const year = Number(id.slice(1, 5));
  return year >= 1900 && year <= currentYear ? year : null;
}

/**
 * Whether someone born in that year could be under 18. The ID only holds the
 * year, so only refuse when they are certainly too young.
 */
export function certainlyUnderAge(birthYear: number, currentYear: number): boolean {
  return currentYear - birthYear < MIN_BORROWER_AGE;
}
