import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  totpCode,
  totpStep,
  totpUri,
  verifyTotp,
} from './totp';

// RFC 6238 appendix B uses the ASCII secret "12345678901234567890" (SHA-1).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it('matches the RFC test vectors, truncated to 6 digits', () => {
    const vectors: Array<[number, string]> = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
      [20000000000, '353130'],
    ];
    for (const [seconds, code] of vectors) {
      expect(totpCode(RFC_SECRET, totpStep(seconds * 1000)), String(seconds)).toBe(code);
    }
  });

  it('round-trips base32', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(RFC_SECRET).toString()).toBe('12345678901234567890');
    expect(base32Decode('gezd gnbv-gy3t').toString()).toBe('1234567');
    expect(() => base32Decode('not!base32')).toThrow();
  });

  it('accepts the current code and one step of clock drift either side', () => {
    const atMs = 1_800_000_000_000;
    const step = totpStep(atMs);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), { atMs })).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), { atMs })).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), { atMs })).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), { atMs })).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 2), { atMs })).toBeNull();
  });

  it('rejects a code that was already used', () => {
    const atMs = 1_800_000_000_000;
    const step = totpStep(atMs);
    const code = totpCode(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, { atMs, afterStep: step })).toBeNull();
    expect(verifyTotp(RFC_SECRET, code, { atMs, afterStep: step - 1 })).toBe(step);
  });

  it('rejects malformed codes', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 345', '１２３４５６']) {
      expect(verifyTotp(RFC_SECRET, bad), bad).toBeNull();
    }
  });

  it('generates 160-bit secrets and a standard otpauth URI', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
    const uri = new URL(totpUri(secret, 'kevin@koralend.test'));
    expect(uri.protocol).toBe('otpauth:');
    expect(decodeURIComponent(uri.pathname)).toBe('//totp/Kora Lend:kevin@koralend.test'.slice(6));
    expect(uri.searchParams.get('secret')).toBe(secret);
    expect(uri.searchParams.get('issuer')).toBe('Kora Lend');
  });
});
