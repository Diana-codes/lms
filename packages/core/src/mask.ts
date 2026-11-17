/**
 * Masking for personal data shown in UIs and written to logs. The designs
 * show phones as "+250 78• ••• 412": country code, first two digits of the
 * number, then only the last three.
 */
const DOT = '•';

/** "+250788123412" -> "+250 78• ••• 412". Unknown shapes keep only the last 3 digits. */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return DOT.repeat(digits.length);
  const local = digits.startsWith('250') && digits.length === 12 ? digits.slice(3) : null;
  if (local) {
    return `+250 ${local.slice(0, 2)}${DOT} ${DOT.repeat(3)} ${local.slice(-3)}`;
  }
  return `${DOT.repeat(digits.length - 3)}${digits.slice(-3)}`;
}

/** Rwandan national ID (16 digits) -> "•••• •••• •••• •821". Keeps the last 3 only. */
export function maskNationalId(id: string | null | undefined): string {
  if (!id) return '';
  const digits = id.replace(/\D/g, '');
  if (digits.length <= 3) return DOT.repeat(digits.length);
  const masked = DOT.repeat(digits.length - 3) + digits.slice(-3);
  return masked.replace(/(.{4})(?=.)/g, '$1 ');
}

/** "aline.uwase@example.com" -> "a••••@example.com". */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at < 1) return DOT.repeat(4);
  return `${email[0]}${DOT.repeat(4)}${email.slice(at)}`;
}

const PHONE_IN_TEXT = /\+?250[\s-]?7\d(?:[\s-]?\d){7}\b|\b07\d(?:[\s-]?\d){7}\b/g;
const NID_IN_TEXT = /\b[123](?:\s?\d){15}\b/g;

/** Scrub phone and ID numbers out of free text before it is logged. */
export function redactPii(text: string): string {
  return text
    .replace(NID_IN_TEXT, (m) => maskNationalId(m))
    .replace(PHONE_IN_TEXT, (m) => {
      const digits = m.replace(/\D/g, '');
      return maskPhone(digits.startsWith('250') ? `+${digits}` : `+250${digits.slice(1)}`);
    });
}

/** Normalise a Rwandan mobile number to E.164, or return null if it isn't one. */
export function normaliseRwPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  let local: string;
  if (digits.length === 12 && digits.startsWith('250')) local = digits.slice(3);
  else if (digits.length === 10 && digits.startsWith('0')) local = digits.slice(1);
  else if (digits.length === 9) local = digits;
  else return null;
  return /^7[2389]\d{7}$/.test(local) ? `+250${local}` : null;
}

/** MTN Rwanda mobile numbers start 078 or 079 (Airtel is 072 and 073). Takes E.164. */
export function isMtnRwPhone(e164: string): boolean {
  return /^\+2507[89]\d{7}$/.test(e164);
}

/** "Aline Uwase" -> "AU"; "Kalisa Trading Ltd" -> "KT". */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const second = words.length > 1 ? (words[1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}
